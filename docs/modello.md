# Come funziona il modello

Il calcolo sta tutto in `model.js` e gira nel browser. Questa pagina lo descrive in parole; i parametri sono nel codice.

> Nessun modello è stato addestrato o validato su dati reali. I dati misurati fissano il punto di partenza; l'andamento futuro del clima e la risposta di colture e animali sono ipotesi.

## Simulazione

| Elemento | Valore |
| --- | --- |
| Futuri simulati | 300 |
| Orizzonte | 30 anni, dal 2027 al 2056 |
| Passo | Quattro stagioni l'anno |
| Scenari di emissioni | Tre, con pesi 25%, 50%, 25% |
| Modelli climatici | Cinque, sintetici |
| Forme di risposta di colture e animali | Tre |
| Tasso di sconto | 4% |

Ogni futuro combina cinque fonti di incertezza: clima, risposta agronomica, errore delle misure, prezzi e struttura del modello.

## Cosa viene simulato

- **Fenologia.** Inizio della primavera, ultima notte fredda, esposizione al caldo, penalità per semine troppo anticipate.
- **Acqua.** Bilancio idrico stagionale e risposta della resa alla carenza d'acqua.
- **Suolo.** Sostanza organica e salinità.
- **Parassiti.** Pressione legata al clima.
- **Allevamento.** Stress da caldo e disponibilità di foraggi.
- **Economia.** Prezzi con andamento autoregressivo, costo del denaro, assicurazione parametrica.

## Le decisioni

Sei mosse reversibili (varietà, calendario, gestione del suolo, difesa integrata, sensori, assicurazione) e quattro investimenti (irrigazione e accumulo idrico, riconversione di parte della coltura, reti e protezioni, spostamento su un appezzamento più fresco): 96 × 16 = 1.536 combinazioni, tutte valutate.

## Come si sceglie il piano

| Metodo | A cosa serve |
| --- | --- |
| Punteggio in euro | Somma profitto medio e risultato nei futuri peggiori, con un prezzo per acqua, CO₂ e biodiversità |
| Fronte delle alternative migliori | Le combinazioni che nessun'altra supera su guadagno e rischio insieme |
| Albero a tre stadi | Cosa decidere nel 2027, nel 2031 e nel 2036, a seconda di come vanno gli anni |
| Opzioni reali | Quanto vale aspettare prima di un investimento che non si può disfare |
| Ottimizzazione robusta | Il piano migliore se le probabilità del modello sono sbagliate |
| Aggiornamento con le osservazioni | I futuri vengono ripesati sui dati di stagione inseriti |
| Valore dell'informazione | Quanto conviene pagare per una misura prima di decidere |

## La stagione in corso

I futuri vengono ripesati sul meteo rilevato negli ultimi 90 giorni. Il peso di quel segnale non è fissato a mano: è la correlazione misurata, sulla storia della sede, tra lo stesso periodo degli anni passati e l'inverno successivo. Poi il modello prova ogni data di semina o trapianto e sceglie quella con il miglior equilibrio tra margine medio e annate peggiori.

## Dati usati per calibrare la sede

| Dato | Fonte | Periodo |
| --- | --- | --- |
| Temperature giornaliere | Rianalisi ERA5-Land, tramite Open-Meteo | 1991-2025 |
| Piogge giornaliere | Rianalisi ERA5, tramite Open-Meteo | 1991-2025 |
| Clima «di oggi» | Media delle stagioni 2016-2025 | |
| Variabilità dei prezzi | Eurostat, prezzi alla produzione in Italia | Dal 2000 |
| Stazione dell'azienda | File CSV caricato, se copre almeno tre anni | |

## Cosa manca per fidarsi dei numeri

1. Una verifica sul passato: rese regionali reali contro i risultati simulati per le stesse annate.
2. Proiezioni climatiche ufficiali al posto dei tassi di riscaldamento scelti a mano.
3. Prove in campo con aziende pilota.
