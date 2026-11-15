# Installazione e avvio

## Requisiti

| Cosa | Serve per | Obbligatorio |
| --- | --- | --- |
| [Node.js](https://nodejs.org) 18 o successivo | Avviare Agro | Sì |
| Un browser recente | Usare Agro | Sì |
| Connessione a internet | Clima, prezzi, partita IVA, bandi | Per quelle funzioni |
| [Claude Code](https://claude.com/claude-code), con accesso già fatto | My Agro con IA, diagnosi da foto, bandi | No |
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) | Link pubblico temporaneo | No |

Non ci sono pacchetti da installare: `npm install` non serve.

## Avvio

### Mac

Doppio clic su `Avvia Agro.command`. Si apre una finestra del Terminale e poi il browser su <http://localhost:4747>.

Al primo avvio macOS può chiedere conferma: clic destro sul file, poi «Apri».

### Windows e Linux

```bash
node server.js
```

Poi apri a mano <http://localhost:4747>.

### Per fermarlo

Chiudi la finestra del Terminale oppure premi `Ctrl+C`.

## Impostazioni

Si passano come variabili d'ambiente prima del comando.

| Variabile | Effetto | Esempio |
| --- | --- | --- |
| `AGRO_PORT` | Cambia la porta (predefinita 4747) | `AGRO_PORT=8080 node server.js` |
| `AGRO_NO_OPEN` | Non apre il browser all'avvio (Mac) | `AGRO_NO_OPEN=1 node server.js` |
| `AGRO_NO_IA` | Spegne le funzioni di intelligenza artificiale | `AGRO_NO_IA=1 node server.js` |

## Funzioni di intelligenza artificiale

My Agro, la diagnosi da foto e la ricerca dei bandi usano Claude Code, se è installato sul computer dove gira Agro e l'accesso è già stato fatto. All'avvio il Terminale dice se sono attive.

- Senza Claude Code, My Agro risponde con le cifre calcolate e le altre due funzioni restano spente. Simulazioni e piano funzionano lo stesso.
- Ogni richiesta consuma l'abbonamento o il credito di chi ha fatto l'accesso.
- Foto e PDF caricati vengono salvati in `dati/caricati` per il tempo dell'analisi e poi cancellati.

## Link pubblico temporaneo

Per far provare Agro ad altri senza installare nulla, su Mac: doppio clic su `Condividi Agro.command`.

- Accende Agro se è spento, apre un collegamento Cloudflare Tunnel e mostra un indirizzo `https://….trycloudflare.com`, copiato anche negli appunti.
- Il link vale finché il computer resta acceso e sveglio e le finestre del Terminale restano aperte. A ogni nuovo avvio cambia.
- Chi entra dal link non legge né modifica i dati salvati sul computer: account e azienda restano nel suo browser.
- Chi ha il link usa però le funzioni di intelligenza artificiale del computer che ospita. Va dato solo a chi serve.

## Dove finiscono i dati

| File | Contenuto |
| --- | --- |
| `dati/azienda.json` | Azienda e sedi inserite |
| `dati/account.json` | Account della pagina di iscrizione; la password è salvata solo come impronta |
| `dati/clima.json`, `dati/meteo.json` | Clima e meteo scaricati, per non richiederli ogni volta |
| `dati/prezzi.json` | Prezzi scaricati da Eurostat |
| `dati/caricati/` | Foto e PDF durante l'analisi |

La cartella `dati/` è esclusa dal repository tramite `.gitignore`. Per ripartire da zero basta cancellarla.

## Problemi frequenti

| Problema | Cosa fare |
| --- | --- |
| «Serve Node.js» | Installa Node.js e riavvia |
| La porta 4747 è occupata | Avvia con un'altra porta: `AGRO_PORT=4800 node server.js` |
| Il clima non compare | Controlla la connessione e che il comune della sede sia scritto per intero |
| My Agro risponde solo con le cifre | Claude Code non è installato o l'accesso non è stato fatto |
| Il link pubblico non si apre più | Il computer è andato in pausa o il collegamento è scaduto: rilancia `Condividi Agro.command` |
| La pagina non mostra le ultime modifiche | Ricarica con `Cmd+Shift+R` (Mac) o `Ctrl+F5` |
