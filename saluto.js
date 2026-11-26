/*
 * Saluto in cima al portale: "Buongiorno Simone, bentornato su SICIET HUB.
 * Buon lavoro!" e riquadro METEO di oggi (SICIET_METEO in apps.js).
 *
 * Il nome lo scrive l'utente (matita accanto al saluto) e resta memorizzato
 * su questo dispositivo; se ha già usato il modulo ferie si usa quello.
 * Il meteo arriva da Open-Meteo (gratuito, senza chiave) e viene tenuto per
 * 30 minuti; se non risponde il riquadro non compare.
 */
(function () {
  "use strict";

  var NAME_KEY = "siciet-nome";
  var FORM_NAME_KEY = "siciet-richieste-nome"; // salvato da richieste.html
  var WEATHER_KEY = "siciet-meteo-v2";
  var WEATHER_TTL = 30 * 60 * 1000;

  var $ = function (id) { return document.getElementById(id); };

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---------- Saluto ---------- */

  function userName() {
    var n = load(NAME_KEY);
    if (typeof n === "string" && n) return n;
    var f = load(FORM_NAME_KEY);
    return f && f.nome ? f.nome : "";
  }

  function salutation() {
    var h = new Date().getHours();
    if (h >= 5 && h < 13) return "Buongiorno";
    if (h >= 13 && h < 18) return "Buon pomeriggio";
    return "Buonasera";
  }

  function renderGreeting() {
    var name = userName();
    $("greetingText").textContent = salutation() + (name ? " " + name : "") + ", bentornato su SICIET HUB. Buon lavoro!";
    $("greetingEdit").setAttribute("aria-label", name ? "Cambia il tuo nome" : "Scrivi il tuo nome");
    $("greetingEdit").title = $("greetingEdit").getAttribute("aria-label");
  }

  $("greetingEdit").addEventListener("click", function () {
    var form = $("greetingForm");
    form.hidden = !form.hidden;
    if (!form.hidden) {
      $("greetingName").value = userName();
      $("greetingName").focus();
    }
  });

  $("greetingForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = $("greetingName").value.trim().replace(/\s+/g, " ");
    if (n) save(NAME_KEY, n);
    else { try { localStorage.removeItem(NAME_KEY); } catch (err) {} }
    $("greetingForm").hidden = true;
    renderGreeting();
  });

  /* ---------- Meteo ---------- */

  // Codice meteo WMO -> [icona, descrizione breve]; di notte sereno = luna.
  function weatherLook(code, isDay) {
    if (code === 0) return [isDay ? "☀️" : "🌙", "Sereno"];
    if (code === 1) return [isDay ? "🌤️" : "🌙", "Poco nuvoloso"];
    if (code === 2) return ["⛅", "Parzialmente nuvoloso"];
    if (code === 3) return ["☁️", "Nuvoloso"];
    if (code === 45 || code === 48) return ["🌫️", "Nebbia"];
    if (code >= 51 && code <= 57) return ["🌦️", "Pioviggine"];
    if (code >= 61 && code <= 67) return ["🌧️", "Pioggia"];
    if (code >= 71 && code <= 77) return ["❄️", "Neve"];
    if (code >= 80 && code <= 82) return ["🌦️", "Rovesci"];
    if (code === 85 || code === 86) return ["🌨️", "Rovesci di neve"];
    if (code >= 95) return ["⛈️", "Temporale"];
    return ["🌡️", ""];
  }

  function renderBox(w) {
    var cfg = window.SICIET_METEO;
    if (!w || typeof w.temp !== "number") return;
    var look = weatherLook(typeof w.nowCode === "number" ? w.nowCode : w.code, w.isDay !== 0);
    $("meteoIcon").textContent = look[0];
    $("meteoLabel").textContent = "Meteo · " + cfg.luogo;
    $("meteoTemp").textContent = Math.round(w.temp) + "°";
    $("meteoDesc").textContent = look[1];
    $("meteoMin").textContent = typeof w.min === "number" ? Math.round(w.min) + "°" : "–";
    $("meteoMax").textContent = typeof w.max === "number" ? Math.round(w.max) + "°" : "–";
    $("meteo").hidden = false;
  }

  function loadWeather() {
    var cfg = window.SICIET_METEO;
    if (!cfg || !window.fetch) return;
    var cached = load(WEATHER_KEY);
    if (cached && cached.luogo === cfg.luogo && Date.now() - cached.t < WEATHER_TTL) {
      renderBox(cached);
      return;
    }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + cfg.lat + "&longitude=" + cfg.lon +
      "&current=temperature_2m,weather_code,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FRome&forecast_days=1";
    fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.current || !d.daily) return;
        var w = {
          t: Date.now(),
          luogo: cfg.luogo,
          temp: d.current.temperature_2m,
          nowCode: d.current.weather_code,
          isDay: d.current.is_day,
          code: (d.daily.weather_code || [])[0],
          min: (d.daily.temperature_2m_min || [])[0],
          max: (d.daily.temperature_2m_max || [])[0]
        };
        save(WEATHER_KEY, w);
        renderBox(w);
      })
      .catch(function () {});
  }

  renderGreeting();
  loadWeather();
})();
