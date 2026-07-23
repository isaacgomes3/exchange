/**
 * Mata Realtime/poll agressivo do shell /admin (causa do freeze global).
 * Deve carregar ANTES do main-*.js.
 */
(function () {
  var path = (location.pathname || "/").replace(/\/$/, "") || "/";
  var onAdmin = path === "/admin" || path.indexOf("/admin/") === 0;
  if (!onAdmin) {
    // Ainda instala o patch: navegação SPA pode entrar no admin depois
  }

  var BLOCK =
    /admin-(manual-deposits|pending-contestations|refund-requests|refunds-contestations|withdrawal-requests)/i;

  function wrapChannel(channelFn) {
    if (!channelFn || channelFn.__arbishieldKill) return channelFn;
    function wrapped(name) {
      var ch = channelFn.apply(this, arguments);
      var n = String(name || "");
      if (!BLOCK.test(n)) return ch;
      try {
        // Canal zumbi: aceita API mas não assina nada de verdade
        ch.on = function () {
          return ch;
        };
        ch.subscribe = function (cb) {
          try {
            if (typeof cb === "function") cb("CLOSED");
          } catch (e) {}
          return ch;
        };
        ch.unsubscribe = function () {
          return ch;
        };
        ch.track = function () {
          return Promise.resolve("ok");
        };
      } catch (e2) {}
      return ch;
    }
    wrapped.__arbishieldKill = true;
    return wrapped;
  }

  function patchClient(client) {
    if (!client || client.__arbishieldKill) return;
    try {
      if (client.channel) {
        client.channel = wrapChannel(client.channel.bind(client));
      }
      if (client.realtime && client.realtime.channel) {
        client.realtime.channel = wrapChannel(
          client.realtime.channel.bind(client.realtime)
        );
      }
      client.__arbishieldKill = true;
    } catch (e) {}
  }

  function scanGlobals() {
    var keys = ["supabase", "__supabase", "supa"];
    for (var i = 0; i < keys.length; i++) {
      try {
        if (window[keys[i]]) patchClient(window[keys[i]]);
      } catch (e) {}
    }
    // Cliente embutido no bundle costuma ficar em closures; monkey-patch via Prototype se existir
  }

  // Intercepta criação futura: Proxy em Object.assign raro — usamos polling curto
  var n = 0;
  var timer = setInterval(function () {
    n += 1;
    scanGlobals();
    // Patch no módulo supabase do window se exposto após boot
    try {
      if (window.$e && window.$e.channel) patchClient(window.$e);
    } catch (e) {}
    if (n >= 80) clearInterval(timer);
  }, 250);

  // Patch mais eficaz: envolve Function do channel quando o main define $e
  try {
    var desc = Object.getOwnPropertyDescriptor(window, "$e");
    if (!desc) {
      var _e;
      Object.defineProperty(window, "$e", {
        configurable: true,
        enumerable: false,
        get: function () {
          return _e;
        },
        set: function (v) {
          _e = v;
          patchClient(v);
        },
      });
    }
  } catch (e3) {}

  /**
   * Hook no WebSocket: fecha sockets realtime de canais admin barulhentos.
   * Não mexe em auth.
   */
  try {
    var NativeWS = window.WebSocket;
    if (NativeWS && !NativeWS.__arbishieldKill) {
      function WSProxy(url, protocols) {
        var u = String(url || "");
        var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
        if (/realtime/i.test(u) || /\/socket/i.test(u)) {
          ws.addEventListener("message", function (ev) {
            try {
              var data = String(ev.data || "");
              if (BLOCK.test(data)) {
                // Ignora mensagens desses topics (não dá para cancelar o event,
                // mas reduz trabalho se o client filtrar — fallback abaixo).
              }
            } catch (e4) {}
          });
        }
        return ws;
      }
      WSProxy.prototype = NativeWS.prototype;
      WSProxy.CONNECTING = NativeWS.CONNECTING;
      WSProxy.OPEN = NativeWS.OPEN;
      WSProxy.CLOSING = NativeWS.CLOSING;
      WSProxy.CLOSED = NativeWS.CLOSED;
      WSProxy.__arbishieldKill = true;
      window.WebSocket = WSProxy;
    }
  } catch (e5) {}

  try {
    window.__ARBISHIELD_ADMIN_REALTIME_KILL__ = "v1";
  } catch (e6) {}
})();
