/*
 * Logica di apertura delle app.
 *
 * ANDROID
 *   - App con scheme noto: si usa un "intent://" URL. Chrome (e i browser basati
 *     su Chromium, Samsung Internet incluso) apre l'app se è installata,
 *     altrimenti va da solo alla pagina del Play Store (S.browser_fallback_url).
 *     È il metodo ufficiale e affidabile, senza timer.
 *   - App senza scheme noto: si apre la pagina del Play Store, che mostra
 *     "Apri" se l'app è già installata o "Installa" se non lo è.
 *
 * iOS
 *   iOS non permette a una pagina web di sapere se un'app è installata.
 *   Si prova ad aprire lo scheme dell'app; se entro qualche secondo la pagina
 *   è ancora visibile (quindi l'app non si è aperta) si va all'App Store.
 *   In ogni caso compare un pannello con i pulsanti manuali come riserva.
 *
 * PC
 *   Si controlla l'IP pubblico: se è uno di quelli della sede (SICIET_OFFICE_IPS)
 *   e l'app ha "desktop.scheme", si apre il programma installato sul PC.
 *   Altrimenti si apre la versione web (se c'è) o si mostra un pannello con i
 *   link agli store. Il browser non permette di sapere se il programma si è
 *   aperto: per questo compare sempre un pannello con la versione web di riserva.
 */
(function () {
  "use strict";

  var IOS_FALLBACK_MS = 2500;
  var IP_LOOKUP_URL = "https://api.ipify.org?format=json";
  var IP_LOOKUP_TIMEOUT_MS = 3000;
  var officeCheck = null;

  function detectPlatform() {
    var ua = navigator.userAgent || "";
    // iPadOS 13+ si presenta come Mac: lo si riconosce dal touch.
    var isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/i.test(ua) || isIPadOS) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "desktop";
  }

  function playStoreUrl(pkg) {
    return "https://play.google.com/store/apps/details?id=" + encodeURIComponent(pkg) + "&hl=it";
  }

  function androidIntentUrl(app) {
    var a = app.android;
    return "intent://#Intent;scheme=" + a.scheme +
      ";package=" + a.package +
      ";S.browser_fallback_url=" + encodeURIComponent(playStoreUrl(a.package)) +
      ";end";
  }

  function storeUrl(app, platform) {
    if (platform === "ios") return app.ios && app.ios.store;
    if (platform === "android") return app.android && playStoreUrl(app.android.package);
    return null;
  }

  function storeName(platform) {
    return platform === "ios" ? "App Store" : "Play Store";
  }

  /* Prova lo scheme su iOS; se la pagina resta visibile, va allo store. */
  function tryIosScheme(scheme, store) {
    var cancelled = false;

    function cancel() {
      if (document.visibilityState === "hidden") cancelled = true;
    }
    function onPageHide() { cancelled = true; }

    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("pagehide", onPageHide);

    window.location.href = scheme;

    setTimeout(function () {
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("pagehide", onPageHide);
      if (!cancelled && document.visibilityState === "visible") {
        window.location.href = store;
      }
    }, IOS_FALLBACK_MS);
  }

  /*
   * Promise<boolean>: true se il dispositivo esce su Internet da un IP della sede.
   * La verifica viene fatta una sola volta per pagina.
   */
  function isOfficeNetwork() {
    if (officeCheck) return officeCheck;
    var ips = window.SICIET_OFFICE_IPS || [];
    if (!ips.length || !window.fetch) return (officeCheck = Promise.resolve(false));

    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, IP_LOOKUP_TIMEOUT_MS);
    });
    var lookup = fetch(IP_LOOKUP_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.ip; })
      .catch(function () { return null; });

    officeCheck = Promise.race([lookup, timeout]).then(function (ip) {
      return !!ip && ips.indexOf(ip) >= 0;
    });
    return officeCheck;
  }

  /* Apre un programma desktop tramite il suo scheme (es. "msteams:"). */
  function launchDesktop(app) {
    window.location.href = app.desktop.scheme;
  }

  /*
   * Avvia l'app. Restituisce un oggetto che descrive cosa è stato fatto,
   * così l'interfaccia può mostrare i pulsanti di riserva corretti.
   */
  function launch(app, platform) {
    platform = platform || detectPlatform();

    if (platform === "android" && app.android) {
      if (app.android.scheme) {
        window.location.href = androidIntentUrl(app);
        return { action: "open", store: playStoreUrl(app.android.package) };
      }
      window.location.href = playStoreUrl(app.android.package);
      return { action: "store", store: playStoreUrl(app.android.package) };
    }

    if (platform === "ios" && app.ios) {
      if (app.ios.scheme) {
        tryIosScheme(app.ios.scheme, app.ios.store);
        return { action: "open", store: app.ios.store };
      }
      window.location.href = app.ios.store;
      return { action: "store", store: app.ios.store };
    }

    return { action: "none" };
  }

  window.SicietLauncher = {
    detectPlatform: detectPlatform,
    launch: launch,
    isOfficeNetwork: isOfficeNetwork,
    launchDesktop: launchDesktop,
    storeUrl: storeUrl,
    storeName: storeName,
    playStoreUrl: playStoreUrl,
    androidIntentUrl: androidIntentUrl
  };
})();
