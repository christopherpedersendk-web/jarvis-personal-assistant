import {developmentGithub} from './self-development-github.mjs';
import {runBoundedProcess} from './subprocess-safety.mjs';
// Trusted host-side transport only. No gh executable, config or token is sent
// to Codex, dynamic tools or Docker. Fixed repository and typed M18 operations.
export function developmentGithubCli({env=process.env,run=runBoundedProcess}={}){
 if(env.JARVIS_CODEX_GITHUB_CLI!=='yes')return null;
 const environment={PATH:env.PATH,HOME:env.HOME,...(env.XDG_CONFIG_HOME?{XDG_CONFIG_HOME:env.XDG_CONFIG_HOME}:{}),GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'};
 return developmentGithub({env:{},request:async(path,method,body)=>{
  if(!path.startsWith('/')||/[\r\n\0]/.test(path)||!['GET','POST'].includes(method))throw Error('GitHub-kald afvist.');
  const args=['api','--hostname','github.com','--method',method,'repos/christopherpedersendk-web/jarvis-personal-assistant'+path,...(body?['--input','-']:[])];
  const result=await run('/usr/bin/gh',args,{environment,input:body?JSON.stringify(body):undefined,timeoutMs:15000,maxOutputBytes:1000000});
  if(!result.ok)throw Error('GitHub-kaldets udfald kunne ikke bekræftes. Ingen automatisk gentagelse.');
  try{return JSON.parse(result.output);}catch{throw Error('GitHub returnerede ikke et verificerbart svar.');}
 }});
}
