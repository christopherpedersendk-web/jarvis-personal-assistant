// Presentation only: all commands and permissions remain in the existing handlers.
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const get = id => document.getElementById(id);
    const composer = get('message-form');
    if (!composer) return;
    const shortcuts = document.createElement('div');
    shortcuts.className = 'workspace-prompts';
    shortcuts.setAttribute('aria-label', 'Forslag til en besked');
    for (const [label, message] of [['Madplan', 'Hjælp mig med en madplan til næste uge.'], ['Find en vare', 'Hjælp mig med at finde og sammenligne en vare.'], ['Udviklingsønske', 'Jeg vil gerne forbedre JARVIS: ']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary'; button.textContent = label;
      button.addEventListener('click', () => {
        const input = get('message');
        // Never replace a draft or submit an example automatically.
        if (!input.value.trim()) {
          input.value = message;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        input.focus();
      });
      shortcuts.append(button);
    }
    composer.after(shortcuts);
    const activity = document.createElement('p'); activity.id = 'workspace-activity';
    activity.className = 'workspace-activity'; activity.setAttribute('role', 'status');
    activity.textContent = 'Hent overblik for at se aktuel status.';
    const overview = get('home-chat-host');
    overview?.append(activity);
    const tools = document.createElement('nav'); tools.className = 'workspace-shortcuts';
    tools.setAttribute('aria-label', 'Genveje');
    for (const [label, route] of [['Madplan', 'plan&section=meals'], ['Noter og lister', 'plan&section=notes'], ['Indkøb', 'shopping'], ['Udvikling', 'development']]) {
      const a = document.createElement('a'); a.href = '?view=' + route; a.textContent = label;
      a.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        const url = new URL(a.href);
        selectTab(url.searchParams.get('view'), { section: url.searchParams.get('section') || undefined });
      }); tools.append(a);
    }
    overview?.append(tools);
    // Relocate existing controls, retaining listeners and exact stop semantics.
    const stop = get('assistant-control-stop');
    if (stop) {
      const controls = document.createElement('details'); controls.className = 'workspace-stop';
      const summary = document.createElement('summary'); summary.textContent = 'Stop og forbrugsstatus';
      controls.append(summary);
      for (const id of ['assistant-control-refresh', 'assistant-control-stop', 'assistant-control-resume', 'assistant-control-status']) {
        const item = get(id); if (item) controls.append(item);
      }
      get('workspace-main')?.before(controls);
    }
  });
})();
