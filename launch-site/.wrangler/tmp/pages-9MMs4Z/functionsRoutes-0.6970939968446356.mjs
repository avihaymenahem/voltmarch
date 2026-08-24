import { onRequestPost as __api_subscribe_js_onRequestPost } from "C:\\Users\\Administrator\\projects\\voltmarch\\launch-site\\functions\\api\\subscribe.js"
import { onRequest as __api_subscribe_js_onRequest } from "C:\\Users\\Administrator\\projects\\voltmarch\\launch-site\\functions\\api\\subscribe.js"

export const routes = [
    {
      routePath: "/api/subscribe",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_subscribe_js_onRequestPost],
    },
  {
      routePath: "/api/subscribe",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_subscribe_js_onRequest],
    },
  ]