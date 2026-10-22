/*
 * Eventi di calendario per le richieste ferie e permessi.
 * Usato da richieste.html (allegato .ics nella email) e da calendario.html.
 *
 * Un evento è { t: tipo, allDay: true|false, a: Date inizio, b: Date fine }.
 * Per le giornate intere "b" è l'ultimo giorno compreso.
 */
(function () {
  "use strict";

  function pad(n) { return String(n).padStart(2, "0"); }
  function isoDay(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nextDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  // Ora in UTC, così il calendario la colloca correttamente qualunque sia il fuso.
  function utc(d) { return d.toISOString().replace(/\.\d{3}Z$/, "Z"); }

  function title(ev, nome) { return ev.t + " – " + nome; }

  function description(nome, email, note) {
    return "Richiesta di " + nome + (email ? " (" + email + ")" : "") + " inviata da SICIET HUB." +
      (note ? "\nNote: " + note : "");
  }

  function icsEscape(s) {
    return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function icsDate(d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function icsUtc(d) { return utc(d).replace(/[-:]/g, ""); }

  /*
   * File .ics con uno o più eventi. Gli eventi sono segnati come
   * "Disponibile" per non occupare l'agenda di chi li salva.
   */
  function ics(events, nome, email, note) {
    var stamp = icsUtc(new Date());
    var uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SICIET//SICIET HUB//IT",
      "METHOD:PUBLISH"
    ];
    events.forEach(function (ev, i) {
      lines.push(
        "BEGIN:VEVENT",
        "UID:" + uid + "-" + i + "@hub.siciet.it",
        "DTSTAMP:" + stamp,
        ev.allDay ? "DTSTART;VALUE=DATE:" + icsDate(ev.a) : "DTSTART:" + icsUtc(ev.a),
        ev.allDay ? "DTEND;VALUE=DATE:" + icsDate(nextDay(ev.b)) : "DTEND:" + icsUtc(ev.b),
        "SUMMARY:" + icsEscape(title(ev, nome)),
        "DESCRIPTION:" + icsEscape(description(nome, email, note)),
        "TRANSP:TRANSPARENT",
        "X-MICROSOFT-CDO-BUSYSTATUS:FREE",
        "X-MICROSOFT-CDO-ALLDAYEVENT:" + (ev.allDay ? "TRUE" : "FALSE"),
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  /* Testo -> base64 (UTF-8), per allegati e link. */
  function base64(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = "";
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  /* Link a Outlook sul web con l'evento compilato (fine esclusiva per le giornate intere). */
  function outlookUrl(ev, nome, email, note) {
    var q = {
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: title(ev, nome),
      body: description(nome, email, note)
    };
    if (ev.allDay) {
      q.allday = "true";
      q.startdt = isoDay(ev.a);
      q.enddt = isoDay(nextDay(ev.b));
    } else {
      q.startdt = utc(ev.a);
      q.enddt = utc(ev.b);
    }
    return "https://outlook.office.com/calendar/0/deeplink/compose?" + Object.keys(q).map(function (k) {
      return k + "=" + encodeURIComponent(q[k]);
    }).join("&");
  }

  window.SicietCalendar = {
    title: title,
    ics: ics,
    base64: base64,
    outlookUrl: outlookUrl,
    isoDay: isoDay
  };
})();
