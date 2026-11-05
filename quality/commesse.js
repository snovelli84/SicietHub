/*
 * TABELLA JOB → COMMESSA SICIET
 * -----------------------------
 * In cantiere si scrive solo il JOB: la pagina compila da sola la Commessa
 * SICIET da questa tabella (e la sincronizzazione sul server usa la commessa
 * per trovare la cartella, es. S1852V31 → …\1852 …\V31-…\Qualità Componenti APP).
 * Un JOB che non è qui va scritto con la sua commessa a mano.
 *
 * Una riga per JOB: "JOB": "Commessa SICIET" (formato S + numero + V + variante).
 * Dopo ogni modifica aumentare ?v= di commesse.js in index.html.
 */
var QUALITA_JOB = {
  "1105618": "S1852V31"
};
