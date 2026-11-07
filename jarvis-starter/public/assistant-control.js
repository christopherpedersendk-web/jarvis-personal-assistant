(() => {
  const status = document.getElementById('assistant-control-status');
  const refreshButton = document.getElementById('assistant-control-refresh');
  const stopButton = document.getElementById('assistant-control-stop');
  const resumeButton = document.getElementById('assistant-control-resume');
  if (!status || !refreshButton || !stopButton || !resumeButton) return;
  let generation = 0, busy = false, controlSequence=0, voiceSequence=0, voiceBusy=false;
  const valid = (g, credential) => g === generation && credential && credential === token && !document.getElementById('workspace').classList.contains('hidden');
  function render(data) {
    status.textContent = `${data.stopped ? 'Stoppet' : 'Aktiv'} · ${data.calls} af ${data.limits.callsPerDay} API-kald · ${data.reservedOrUsedOutputTokens} af ${data.limits.outputTokensPerDay} outputtokens brugt eller reserveret · ${data.unresolved} uafklarede kald.`;
    if (data.voice) status.textContent += ` Stemme: ${data.voice.active} aktive, ${data.voice.unresolved} uafklarede, ${data.voice.reservedSecondsToday}/${data.voice.secondsPerDay} sekunder reserveret i dag.`;
    if(data.discordVoice?.enabled) status.textContent += ` Discord-stemme: ${({disconnected:'afbrudt',connecting:'forbinder',listening:'lytter',processing:'behandler',closing:'afbryder'})[data.discordVoice.status]||'ukendt'}, ${data.discordVoice.reservedSecondsToday}/${data.discordVoice.secondsPerDay} sekunder reserveret.`;
    if(data.discordMedia?.enabled)status.textContent+=` Medier: ${data.discordMedia.active?'behandler':'klar'}; ${data.discordMedia.recent.length} seneste opgaver. Brug !medie status i Discord. Globalt stop afbryder også medier.`;
    status.textContent += ` Hosted tools: ${data.reservedHostedToolCalls || 0}/${data.limits.hostedToolCallsPerDay || '—'} kald reserveret. Grænserne er ikke et kronebudget.`;
    stopButton.disabled = data.stopped; resumeButton.disabled = !data.stopped;
    if(data.discordVoice&&!voiceBusy){const start=document.getElementById('discord-voice-start'),stop=document.getElementById('discord-voice-stop');if(start)start.disabled=data.stopped||!data.discordVoice.enabled;if(stop)stop.disabled=!data.discordVoice.enabled;}
  }
  async function load(stopped) {
    if ((busy && stopped!==true) || !token) return;
    const g = generation, credential = token, sequence=++controlSequence; busy = true;
    if(stopped===true){voiceSequence++;voiceBusy=false;}
    stopButton.disabled = resumeButton.disabled = refreshButton.disabled = true;
    try {
      const data = await api('/api/assistant/control', stopped === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stopped }),
      });
      if (!valid(g, credential)||sequence!==controlSequence) return;
      if (stopped === true && typeof stopVoice === 'function') stopVoice();
      render(data);
    } catch (error) {
      if (valid(g, credential)&&sequence===controlSequence) status.textContent = `${error.message} Hent status før en ny handling. Der er ikke genforsøgt.`;
    } finally {
      if (g === generation&&sequence===controlSequence) { busy = false; refreshButton.disabled = false; }
    }
  }
  const voiceStatus=document.getElementById('discord-voice-action-status');
  for(const action of ['start','stop'])document.getElementById(`discord-voice-${action}`)?.addEventListener('click',async()=>{
    if((voiceBusy&&action!=='stop')||!token)return;const g=generation,credential=token,sequence=++voiceSequence;voiceBusy=true;
    const buttons=['start','stop'].map(x=>document.getElementById(`discord-voice-${x}`));buttons[0].disabled=true;buttons[1].disabled=action==='stop';
    try{
      let expectedGeneration;
      if(action==='start'){const current=await api('/api/assistant/control');if(!valid(g,credential)||sequence!==voiceSequence)return;expectedGeneration=current.discordVoice?.generation;}
      const result=await api('/api/discord/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,expectedGeneration,textChannelId:document.getElementById('discord-voice-text-channel').value.trim()})});
      if(valid(g,credential)&&sequence===voiceSequence)voiceStatus.textContent=action==='start'?`Forbundet til ${result.channelId}. Lytter kun til ejeren; se også status i Discord.`:'Stop er registreret lokalt. Providerafslutning er ikke bekræftet.';
    }catch(error){if(valid(g,credential)&&sequence===voiceSequence)voiceStatus.textContent=`${error.message} Hent status før en ny handling.`;}
    finally{if(g===generation&&sequence===voiceSequence){voiceBusy=false;buttons.forEach(x=>x.disabled=false);}}
  });
  refreshButton.addEventListener('click', () => load());
  stopButton.addEventListener('click', () => load(true));
  resumeButton.addEventListener('click', () => load(false));
  document.getElementById('logout')?.addEventListener('click', () => {
    generation++; controlSequence++;voiceSequence++;busy = voiceBusy = false; if(voiceStatus)voiceStatus.textContent=''; if(document.getElementById('discord-voice-text-channel'))document.getElementById('discord-voice-text-channel').value=''; status.textContent = 'Hent status for at se forbrug og stopkontrol.';
    stopButton.disabled = resumeButton.disabled = true; refreshButton.disabled = false;
  });
})();
