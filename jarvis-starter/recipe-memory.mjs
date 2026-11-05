import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discordImageAttachment, fetchRecipeResource, imageMatchesType, MAX_RECIPE_IMAGE_BYTES, recipeUrl } from './recipe-fetch.mjs';
import { createJobTransitions } from './job-state-transition.mjs';
import { BoundedJobQueue } from './bounded-queue.mjs';
import { rejectSecrets } from './privacy.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SNOWFLAKE = /^\d{15,22}$/;
const THEMES = new Set(['everyday', 'child_friendly', 'vegan', 'vegetarian', 'date', 'party', 'quick']);
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'dl', 'cl', 'stk', 'fed', 'tsk', 'spsk', 'pakke']);
const IMAGE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_MEDIA_STORAGE = 100_000_000;
const CAPTURE_PREFIX = /^\s*(?:(?:gem|husk)\s+(?:denne\s+)?opskrift(?:en)?|\/?opskrift)(?:\s*[:\-]\s*|\s+|$)/iu;
const copy = value => structuredClone(value);
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();

function noSecrets(value) {
  rejectSecrets(value);
}

export function isRecipeCaptureRequest(text) { return typeof text === 'string' && CAPTURE_PREFIX.test(text); }

export function recipeCaptureInput(text, metadata = {}) {
  if (!isRecipeCaptureRequest(text)) throw new Error('Skriv “Gem opskrift:” før teksten, linket eller billedet.');
  return { text: text.replace(CAPTURE_PREFIX, '').trim(), attachments: metadata.attachments || [],
    source: { channel: 'discord', messageId: metadata.messageId, channelId: metadata.channelId } };
}

function sourceDescriptor(input = {}) {
  const channel = input.channel || 'web';
  if (!['discord', 'web', 'chat', 'manual'].includes(channel)) throw new Error('Ukendt opskriftskilde.');
  const result = { channel };
  if (channel === 'discord') {
    if (!SNOWFLAKE.test(String(input.messageId || '')) || !SNOWFLAKE.test(String(input.channelId || ''))) throw new Error('Discord-kilden kunne ikke bekræftes.');
    result.messageId = String(input.messageId); result.channelId = String(input.channelId);
  }
  return result;
}

function ingredientList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error('Angiv 1–50 ingredienser med mængder og enheder.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !plain(item.name) || plain(item.name).length > 80 ||
      !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 100000 || !UNITS.has(item.unit)) {
      throw new Error('Hver ingrediens skal have navn, positiv mængde og en understøttet enhed.');
    }
    noSecrets(item.name);
    return { name: plain(item.name), quantity: Math.round(item.quantity * 1000) / 1000, unit: item.unit };
  });
}

function recipeFields(value, { partial = false } = {}) {
  const out = {};
  for (const key of ['title', 'text', 'instructions']) {
    if (partial && !Object.hasOwn(value, key)) continue;
    const field = value[key] ?? '';
    const max = key === 'title' ? 120 : 10000;
    if (typeof field !== 'string' || field.length > max || (key === 'title' && !plain(field))) throw new Error(`Ugyldigt felt: ${key}.`);
    noSecrets(field); out[key] = plain(field);
  }
  if (!partial || Object.hasOwn(value, 'diet')) {
    if (!['unknown', 'omnivore', 'vegetarian', 'vegan'].includes(value.diet)) throw new Error('Vælg en gyldig kosttype for opskriften.');
    out.diet = value.diet;
  }
  for (const [key, max] of [['minutes', 720], ['servings', 50]]) {
    if (partial && !Object.hasOwn(value, key)) continue;
    const number = value[key];
    if (number !== null && (!Number.isFinite(number) || number <= 0 || number > max || (key === 'minutes' && !Number.isInteger(number)))) {
      throw new Error(key === 'minutes' ? 'Tiden skal være 1–720 minutter.' : 'Opskriftens grundportioner skal være større end 0 og højst 50.');
    }
    out[key] = number;
  }
  if (!partial || Object.hasOwn(value, 'themes')) {
    if (!Array.isArray(value.themes) || value.themes.length > 7 || value.themes.some(theme => !THEMES.has(theme))) throw new Error('Vælg et understøttet opskriftstema.');
    out.themes = [...new Set(value.themes)];
  }
  if (!partial || Object.hasOwn(value, 'ingredients')) out.ingredients = value.ingredients?.length ? ingredientList(value.ingredients) : [];
  return out;
}

function parseIngredient(line) {
  const text = plain(line).replace(/\s+/g, ' ');
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gram|ml|milliliter|l|liter|dl|cl|stk\.?|stykker|fed|tsk\.?|spsk\.?|pakke(?:r)?)\s+(.+)$/iu);
  if (!match) return null;
  const aliases = { gram: 'g', milliliter: 'ml', liter: 'l', stykker: 'stk', pakker: 'pakke' };
  const rawUnit = match[2].toLowerCase().replace(/\.$/, '');
  try { return ingredientList([{ name: match[3], quantity: Number(match[1].replace(',', '.')), unit: aliases[rawUnit] || rawUnit }])[0]; }
  catch { return null; }
}

function minutesFromDuration(value) {
  if (typeof value !== 'string') return null;
  const found = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/i);
  const minutes = found ? Number(found[1] || 0) * 60 + Number(found[2] || 0) : 0;
  return minutes > 0 && minutes <= 720 ? minutes : null;
}

function textInstructions(value) {
  if (typeof value === 'string') return plain(value).slice(0, 10000);
  if (!Array.isArray(value)) return '';
  return value.slice(0, 50).flatMap(item => typeof item === 'string' ? [item] :
    item && typeof item.text === 'string' ? [item.text] :
      Array.isArray(item?.itemListElement) ? item.itemListElement.slice(0, 20).map(x => typeof x === 'string' ? x : x?.text || '') : [])
    .map(plain).filter(Boolean).join('\n').slice(0, 10000);
}

export function extractJsonLdRecipe(html) {
  if (typeof html !== 'string' || html.length > 1_000_000) return null;
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].slice(0, 30);
  for (const [, attributes, content] of blocks) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes) || content.length > 200000) continue;
    let value; try { value = JSON.parse(content); } catch { continue; }
    const queue = [value]; let inspected = 0;
    while (queue.length && inspected++ < 200) {
      const item = queue.shift();
      if (Array.isArray(item)) { queue.push(...item.slice(0, 100)); continue; }
      if (!item || typeof item !== 'object') continue;
      const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
      if (types.some(type => typeof type === 'string' && /(?:^|[\/#])Recipe$/.test(type))) {
        const ingredientLines = Array.isArray(item.recipeIngredient) ? item.recipeIngredient.filter(x => typeof x === 'string').slice(0, 50).map(x => plain(x).slice(0, 160)) : [];
        const yieldText = Array.isArray(item.recipeYield) ? item.recipeYield[0] : item.recipeYield;
        const servings = Number(String(yieldText || '').match(/^\s*(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.'));
        const diets = (Array.isArray(item.suitableForDiet) ? item.suitableForDiet : [item.suitableForDiet]).map(String);
        return { title: plain(item.name || 'Gemt opskrift').slice(0, 120), text: plain(item.description || '').slice(0, 3000),
          servings: Number.isFinite(servings) && servings > 0 && servings <= 50 ? servings : null,
          minutes: minutesFromDuration(item.totalTime) || minutesFromDuration(item.cookTime),
          diet: diets.some(x => /(?:\/|^)VeganDiet$/.test(x)) ? 'vegan' : diets.some(x => /(?:\/|^)VegetarianDiet$/.test(x)) ? 'vegetarian' : 'unknown',
          themes: [], ingredients: ingredientLines.map(parseIngredient).filter(Boolean), ingredientLines,
          instructions: textInstructions(item.recipeInstructions) };
      }
      if (Array.isArray(item['@graph'])) queue.push(...item['@graph'].slice(0, 100));
      if (item.mainEntity && typeof item.mainEntity === 'object') queue.push(item.mainEntity);
    }
  }
  return null;
}

function candidateFields(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  // Extractors may suggest fields, never approval, permissions, IDs or actions.
  for (const field of ['title', 'text', 'instructions', 'diet', 'minutes', 'servings', 'themes', 'ingredients']) {
    if (!Object.hasOwn(value, field)) continue;
    try { Object.assign(result, recipeFields({ [field]: value[field] }, { partial: true })); } catch { /* incomplete draft: user reviews */ }
  }
  if (Array.isArray(value.ingredientLines)) result.ingredientLines = value.ingredientLines.filter(x => typeof x === 'string').slice(0, 50).map(x => plain(x).slice(0, 160));
  return result;
}

function publicRecipe(recipe) {
  const { captureKey, ...out } = recipe;
  return copy(out);
}

export class RecipeMemory {
  constructor({ state, save = async () => {}, transact, now = () => new Date(), dataDirectory, extractor = null, fetchResource = fetchRecipeResource,
    onChanged = async () => {}, queue = new BoundedJobQueue({ concurrency: 1, maxWaiting: 8 }) } = {}) {
    if (!state || typeof state !== 'object') throw new Error('Opskriftshukommelsen mangler tilstand.');
    this.state = state; this.save = save; this.now = now; this.extractor = extractor; this.fetchResource = fetchResource;
    this.transact = transact || createJobTransitions(state);
    this.mediaDirectory = dataDirectory ? join(resolve(dataDirectory), 'recipe-media') : null;
    this.state.recipes ||= []; this.queue = queue; this.onChanged = onChanged;
    for (const recipe of this.state.recipes) if (['received', 'processing'].includes(recipe.processingStatus)) {
      recipe.processingStatus = 'error';
      recipe.extraction ||= { status: 'saved-only', messages: [] };
      recipe.extraction.messages.push('Behandlingen blev afbrudt. Originalmaterialet er bevaret; gennemgå eller genoptag udtræk.');
    }
  }

  serialize(operation) {
    try { return this.queue.enqueue('Opskrift · gem eller gennemgå', operation).promise; }
    catch (error) { return Promise.reject(error); }
  }

  jobs() { return this.queue.snapshot(); }
  cancelWaiting(id) { return this.queue.cancel(id); }

  list() { return this.state.recipes.filter(item => !item.archived).slice(0, 200).map(publicRecipe); }
  get(id) {
    const item = this.state.recipes.find(recipe => recipe.id === id && !recipe.archived);
    if (!item) throw new Error('Opskriften findes ikke.');
    return publicRecipe(item);
  }

  async ensureMediaDirectory() {
    if (!this.mediaDirectory) throw new Error('Privat billedlagring er ikke konfigureret.');
    await mkdir(this.mediaDirectory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.mediaDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Billedmappen er ikke en privat mappe.');
  }

  capture(input = {}) { return this.serialize(() => this.captureOne(input)); }

  async captureOne({ text = '', urls = [], attachments = [], source = {} }) {
    if (typeof text !== 'string' || text.length > 10000 || !Array.isArray(urls) || urls.length > 3 || !Array.isArray(attachments) || attachments.length > 3) {
      throw new Error('Gem højst 10.000 tegn, tre links og tre billeder pr. opskrift.');
    }
    noSecrets(text);
    const origin = sourceDescriptor(source);
    const discovered = text.match(/https:\/\/[^\s<>"']+/gi) || [];
    const links = [...new Set([...urls, ...discovered].map(value => recipeUrl(String(value).replace(/[),.;!?]+$/, '')).href))].slice(0, 3);
    const images = attachments.map(value => discordImageAttachment(value, { channelId: origin.channelId }));
    if (attachments.length && (origin.channel !== 'discord' || images.some(image => !image))) throw new Error('Kun PNG-, JPEG- og WebP-billeder fra den godkendte Discord-besked kan gemmes. Maks. 2 MB pr. billede.');
    if (!text.trim() && !links.length && !images.length) throw new Error('Send en opskriftstekst, et HTTPS-link eller et billede.');
    const captureKey = createHash('sha256').update(JSON.stringify({ text: text.trim(), links, attachments: images.map(image => image.id) })).digest('hex');
    const duplicate = this.state.recipes.find(item => item.captureKey === captureKey ||
      (origin.channel === 'discord' && item.source?.channel === 'discord' && item.source.messageId === origin.messageId && item.source.channelId === origin.channelId));
    if (duplicate) return { ...publicRecipe(duplicate), duplicate: true };
    if (this.state.recipes.filter(item => !item.archived).length >= 200 || this.state.recipes.length >= 500) throw new Error('Opskriftshukommelsen er fuld. Arkivér gamle opskrifter, før du gemmer flere.');
    const timestamp = this.now().toISOString();
    const deadline = Date.now() + 45_000;
    const recipe = { id: randomUUID(), revision: 1, status: 'inbox', archived: false, confirmed: false,
      title: plain(text.split('\n').find(line => line.trim() && !/^https:\/\//i.test(line.trim())) || (links[0] ? `Opskrift fra ${new URL(links[0]).hostname}` : 'Opskrift fra billede')).slice(0, 120),
      text: plain(text), instructions: '', diet: 'unknown', minutes: null, servings: null, themes: [], ingredients: [], ingredientLines: [],
      links: [], media: [], source: origin, extraction: { status: 'saved-only', messages: [] },
      processingStatus: 'received', feedback: { favorite: false, doNotSuggest: false },
      original: { text, urls: links, attachments: images.map(({ id, filename, contentType, size }) => ({ id, filename, contentType, size })) },
      createdAt: timestamp, updatedAt: timestamp, reviewedAt: null, captureKey };
    // Receipt is durable BEFORE any fetch/model call. A process exit cannot
    // turn an acknowledged Discord capture into a silently lost recipe.
    await this.transact(['recipes'], async () => { this.state.recipes.unshift(copy(recipe)); await this.save(); });
    return this.processRecipe(recipe, { links, images, deadline });
  }

  resume(id, { expectedRevision } = {}) {
    return this.serialize(async () => {
      const recipe = this.get(id);
      if (!Number.isInteger(expectedRevision) || recipe.revision !== expectedRevision) throw new Error('Opskriften er ændret. Genindlæs før du genoptager udtrækket.');
      if (recipe.confirmed || !['error', 'received', 'processing'].includes(recipe.processingStatus))
        throw new Error('Kun et afbrudt udtræk kan genoptages. Gennemgå eksisterende udkast manuelt.');
      if (!recipe.original) throw new Error('Originalmaterialet mangler. Gennemgå opskriften manuelt.');
      const extractionImages = [];
      for (const descriptor of recipe.media || []) {
        try { extractionImages.push({ ...await this.media(id, descriptor.id) }); }
        catch { recipe.extraction.messages.push('Et gemt billede kunne ikke læses. Gennemgå originalkilden eller send billedet igen.'); }
      }
      if (recipe.original.attachments?.length > extractionImages.length)
        recipe.extraction.messages.push('Et oprindeligt billede blev ikke gemt. Discord-linket genbruges ikke; send billedet igen.');
      return this.processRecipe(recipe, { links: recipe.original.urls || [], images: [], extractionImages,
        deadline: Date.now() + 45_000, resume: true });
    });
  }

  async processRecipe(recipe, { links, images, deadline, extractionImages = [], resume = false }) {
    const text = recipe.original.text;
    const origin = recipe.source;
    if (resume) { recipe.links = []; recipe.extraction.status = 'saved-only'; }
    await this.transact(['recipes'], async () => {
      const current = this.state.recipes.find(item => item.id === recipe.id);
      if (!current || current.revision !== recipe.revision) throw new Error('Opskriften blev ændret før udtræk.');
      current.processingStatus = 'processing'; await this.save();
    });
    for (const url of links) {
      try {
        if (Date.now() >= deadline) throw new Error('Tidsgrænsen er nået.');
        const resource = await this.fetchResource(url, { kind: 'html', timeoutMs: Math.min(10_000, deadline - Date.now()) });
        const extracted = extractJsonLdRecipe(resource.buffer.toString('utf8'));
        if (extracted && recipe.ingredients.length === 0) {
          const suggested = candidateFields(extracted);
          // Preserve what the user actually sent separately from imported text.
          delete suggested.text;
          Object.assign(recipe, suggested);
          recipe.extraction.status = 'draft-extracted';
        }
        recipe.links.push({ url, status: extracted ? 'extracted' : 'bookmark' });
        if (!extracted) recipe.extraction.messages.push('Link gemt. Ingen læsbar struktureret opskrift fundet; indsæt eller gennemgå oplysningerne manuelt.');
      } catch (error) {
        recipe.links.push({ url, status: error.code === 'blocked' ? 'blocked' : 'unavailable' });
        recipe.extraction.messages.push(error.code === 'blocked' ? 'Link gemt uden hentning: adressen er ikke tilladt af netværksbeskyttelsen.' : 'Link gemt; indholdet kunne ikke hentes. Login, video og dynamiske sider læses ikke automatisk.');
      }
    }
    let mediaSize = this.state.recipes.reduce((sum, item) => sum + (item.media || []).reduce((amount, file) => amount + Number(file.size || 0), 0), 0);
    for (const attachment of images) {
      try {
        if (mediaSize + attachment.size > MAX_MEDIA_STORAGE) throw new Error('Billedlageret er fuldt.');
        if (Date.now() >= deadline) throw new Error('Tidsgrænsen er nået.');
        const resource = await this.fetchResource(attachment.url, { kind: 'image', timeoutMs: Math.min(10_000, deadline - Date.now()), maxBytes: Math.min(attachment.size, MAX_RECIPE_IMAGE_BYTES),
          allowUrl: url => Boolean(discordImageAttachment({ ...attachment, url: url.href }, { channelId: origin.channelId })) });
        if (resource.contentType !== attachment.contentType || resource.buffer.length > attachment.size || !imageMatchesType(resource.buffer, resource.contentType)) throw new Error('Billedets type kunne ikke bekræftes.');
        await this.ensureMediaDirectory();
        const id = randomUUID();
        const file = await open(join(this.mediaDirectory, `${id}.${IMAGE_EXTENSIONS[resource.contentType]}`), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(resource.buffer); await file.sync(); } finally { await file.close(); }
        const descriptor = { id, filename: attachment.filename, contentType: resource.contentType, size: resource.buffer.length,
          sha256: createHash('sha256').update(resource.buffer).digest('hex') };
        recipe.media.push(descriptor);
        // Persist the descriptor before calling a model. Restart can then use
        // the original private file without a stale/signed Discord URL.
        await this.transact(['recipes'], async () => {
          const current = this.state.recipes.find(item => item.id === recipe.id);
          if (!current || current.revision !== recipe.revision) throw new Error('Opskriften er ændret.');
          current.media = copy(recipe.media); await this.save();
        });
        mediaSize += resource.buffer.length;
        extractionImages.push({ filename: attachment.filename, contentType: resource.contentType, buffer: resource.buffer });
      } catch { recipe.extraction.messages.push('Et billede kunne ikke gemmes sikkert. Send PNG/JPEG/WebP på højst 2 MB igen, eller indsæt teksten.'); }
    }
    if (this.extractor && (extractionImages.length || (!recipe.ingredients.length && text.trim()) || recipe.ingredientLines.length > recipe.ingredients.length)) {
      let timer;
      const controller = new AbortController();
      try {
        if (Date.now() >= deadline) throw new Error('Tidsgrænsen er nået.');
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new Error('Udtræk tog for lang tid.'));
        }, Math.min(25_000, deadline - Date.now())); });
        const extracted = await Promise.race([this.extractor({ text: recipe.text, images: extractionImages,
          ingredientLines: recipe.ingredientLines, instructions: recipe.instructions, signal: controller.signal }), timeout]);
        const suggested = candidateFields(extracted);
        delete suggested.text;
        if (Object.keys(suggested).length) { Object.assign(recipe, suggested); recipe.extraction.status = 'draft-extracted'; }
      } catch { recipe.extraction.messages.push('Automatisk udtræk kunne ikke fuldføres. Det gemte materiale kan stadig gennemgås manuelt.'); }
      finally { clearTimeout(timer); }
    } else if (extractionImages.length) {
      recipe.extraction.messages.push('Billedet er gemt privat. Automatisk billedudtræk er ikke tilgængeligt; indtast ingredienserne før brug i madplaner.');
    }
    if (recipe.ingredientLines.length > recipe.ingredients.length) recipe.extraction.messages.push('Ikke alle ingrediensmængder kunne aflæses. Gennemgå samtlige linjer før bekræftelse.');
    recipe.extraction.messages.push('Opskriften er et uverificeret udkast og bruges først i madplaner, når du har gennemgået og bekræftet den.');
    recipe.processingStatus = 'review_required';
    await this.transact(['recipes'], async () => {
      const index = this.state.recipes.findIndex(item => item.id === recipe.id);
      if (index < 0 || this.state.recipes[index].revision !== recipe.revision) throw new Error('Opskriften blev ændret under udtræk. Originalmaterialet er bevaret.');
      this.state.recipes[index] = recipe; await this.save();
    });
    return publicRecipe(recipe);
  }

  update(id, input = {}) {
    return this.serialize(() => this.transact(['recipes'], async () => {
      const recipe = this.state.recipes.find(item => item.id === id && !item.archived);
      if (!recipe) throw new Error('Opskriften findes ikke.');
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== recipe.revision) throw new Error('Opskriften er ændret. Genindlæs før du gemmer.');
      if (input.confirmed !== undefined && typeof input.confirmed !== 'boolean') throw new Error('Bekræftelse skal være sand eller falsk.');
      const allowed = ['expectedRevision', 'title', 'text', 'instructions', 'diet', 'minutes', 'servings', 'themes', 'ingredients', 'confirmed', 'favorite', 'doNotSuggest'];
      if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Ukendt opskriftsfelt.');
      for (const key of ['favorite', 'doNotSuggest']) {
        if (Object.hasOwn(input, key) && typeof input[key] !== 'boolean') throw new Error('Favorit og fravalg skal være sand eller falsk.');
      }
      const fields = recipeFields(input, { partial: true });
      const next = { ...recipe, ...fields };
      const remainsConfirmed = input.confirmed === true ||
        (input.confirmed === undefined && Object.keys(fields).length === 0 && recipe.confirmed === true);
      if (input.confirmed === true) {
        if (next.diet === 'unknown' || !next.minutes || !next.servings || !next.ingredients.length) throw new Error('Gennemgå kosttype, tid, grundportioner og ingredienser før bekræftelse.');
        ingredientList(next.ingredients);
        if (next.ingredientLines.length > next.ingredients.length && !Object.hasOwn(input, 'ingredients')) throw new Error('Gennemgå alle importerede ingredienslinjer og angiv en komplet ingrediensliste.');
      }
      Object.assign(recipe, fields, { revision: recipe.revision + 1, confirmed: remainsConfirmed,
        status: remainsConfirmed ? 'confirmed' : 'inbox', updatedAt: this.now().toISOString(),
        reviewedAt: remainsConfirmed ? (recipe.reviewedAt || this.now().toISOString()) : null,
        processingStatus: remainsConfirmed ? 'ready' : 'review_required',
        feedback: { favorite: input.favorite ?? recipe.feedback?.favorite ?? false,
          doNotSuggest: input.doNotSuggest ?? recipe.feedback?.doNotSuggest ?? false } });
      await this.onChanged(id); await this.save(); return publicRecipe(recipe);
    }));
  }

  archive(id) {
    return this.serialize(() => this.transact(['recipes'], async () => {
      const recipe = this.state.recipes.find(item => item.id === id && !item.archived);
      if (!recipe) throw new Error('Opskriften findes ikke.');
      recipe.archived = true; recipe.status = 'archived'; recipe.confirmed = false;
      recipe.processingStatus = 'archived';
      recipe.revision++; recipe.updatedAt = this.now().toISOString();
      await this.onChanged(id); await this.save(); return publicRecipe(recipe);
    }));
  }

  usable() {
    return this.state.recipes.filter(item => !item.archived && item.status === 'confirmed' && item.confirmed === true)
      .flatMap(recipe => {
        try {
          const fields = recipeFields(recipe);
          if (fields.diet === 'unknown' || !fields.minutes || !fields.servings || !fields.ingredients.length) return [];
          return [{ id: recipe.id, title: fields.title, diet: fields.diet, minutes: fields.minutes, servings: fields.servings,
            themes: fields.themes, ingredients: fields.ingredients,
            instructions: fields.instructions, favorite: Boolean(recipe.feedback?.favorite),
            doNotSuggest: Boolean(recipe.feedback?.doNotSuggest),
            sourceRef: { kind: 'recipe', id: recipe.id, revision: recipe.revision } }];
        } catch { return []; }
      });
  }

  instructions(id) {
    const recipe = this.get(id);
    if (!recipe.confirmed || recipe.status !== 'confirmed') throw new Error('Opskriften skal gennemgås og bekræftes før instruktioner bruges.');
    if (!recipe.instructions?.trim()) throw new Error('Opskriften har endnu ingen gemte tilberedningstrin.');
    return { id: recipe.id, title: recipe.title, revision: recipe.revision, instructions: recipe.instructions,
      source: recipe.source };
  }

  async media(id, mediaId) {
    if (!UUID.test(String(id)) || !UUID.test(String(mediaId))) throw new Error('Ugyldigt billed-ID.');
    const recipe = this.get(id);
    const descriptor = recipe.media.find(item => item.id === mediaId);
    if (!descriptor || !IMAGE_EXTENSIONS[descriptor.contentType]) throw new Error('Billedet findes ikke.');
    await this.ensureMediaDirectory();
    const file = await open(join(this.mediaDirectory, `${mediaId}.${IMAGE_EXTENSIONS[descriptor.contentType]}`), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_RECIPE_IMAGE_BYTES || stat.size !== descriptor.size) throw new Error('Billedet kunne ikke verificeres.');
      const buffer = await file.readFile();
      if (!imageMatchesType(buffer, descriptor.contentType)) throw new Error('Billedet kunne ikke verificeres.');
      if (descriptor.sha256 && createHash('sha256').update(buffer).digest('hex') !== descriptor.sha256) throw new Error('Billedets indhold er ændret siden gemning.');
      return { buffer, contentType: descriptor.contentType, filename: descriptor.filename };
    } finally { await file.close(); }
  }
}
