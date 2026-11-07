import {join} from 'node:path';
import {prepareCodexHome,CodexAppServer} from './codex-app-server.mjs';
import {CodexWorktrees} from './codex-worktree.mjs';
import {CodexBridge} from './codex-bridge.mjs';
import {developmentGithub} from './self-development-github.mjs';
import {developmentGithubCli} from './self-development-github-cli.mjs';
export function configuredCodexBridge({env=process.env,sourceRoot,...shared}){
 if(env.JARVIS_CODEX_BRIDGE!=='yes')return null;
 const repository=env.JARVIS_CODEX_REPOSITORY,root=env.JARVIS_CODEX_WORK_ROOT,binary=env.JARVIS_CODEX_BINARY,authSource=env.JARVIS_CODEX_AUTH_SOURCE;
 if(!repository||!root||!binary||!authSource)throw Error('Codex-broen kræver separat repository, privat arbejdsrod, binær og eksisterende Codex-loginfil.');
 const home=join(root,'codex-home'),workspace=new CodexWorktrees({repository,root:join(root,'worktrees'),sourceRoot,fetchMain:true});
 const client=new CodexAppServer({binary,home});
 const original=client.connect.bind(client);client.connect=async()=>{await prepareCodexHome({directory:home,authSource});return original();};
 return new CodexBridge({...shared,workspace,client,github:developmentGithub({env})||developmentGithubCli({env}),enabled:true,model:env.JARVIS_CODEX_MODEL||undefined});
}
