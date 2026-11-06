// Pinned OpenClaw 2026.11.1 configuration, validated by the installed CLI.
// Fresh private state; no user/home config, bots, cron, MCP, browser or model turn.
export function gatewayConfig({port,token,workspace,pluginPath}) {
  return {
    gateway:{mode:'local',bind:'loopback',port,auth:{mode:'token',token,allowTailscale:false},
      controlUi:{enabled:false},uploads:{enabled:false},cliAgents:{enabled:false},terminal:{enabled:false},
      tailscale:{mode:'off'},reload:{mode:'off'},tools:{deny:['browser','web_fetch'],allow:[]}},
    tools:{allow:['web_search'],web:{search:{enabled:true,provider:'parallel-free',maxResults:5,timeoutSeconds:15,cacheTtlMinutes:0},fetch:{enabled:false}}},
    plugins:{allow:['parallel'],load:{paths:[pluginPath]},entries:{parallel:{enabled:true}}},
    agents:{defaults:{workspace,heartbeat:{every:'0m'}}},
    cron:{enabled:false,triggers:{enabled:false}},channels:{},
    skills:{allowBundled:[],load:{extraDirs:[]}},
    discovery:{mdns:{mode:'off'}},update:{checkOnStart:false,auto:{enabled:false}},
    models:{catalogRefresh:{enabled:false}},
  };
}
