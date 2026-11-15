# Diagnosi spiegabile delle piante malate

Come costruire in Agro un modello che riconosce le malattie da una foto e mostra all'agricoltore **perché** lo dice.

Questo documento è una guida di implementazione. Niente di quanto descritto è ancora presente nel codice: gli esempi sono schemi da adattare, non codice provato.

---

## 1. Da dove partiamo

Oggi la scheda «Diagnosi da foto» manda le immagini a un modello di IA generalista (Claude) insieme al contesto dell'azienda. La risposta torna come JSON e viene impaginata da `diagHtml()` in `app.js`.

| Cosa fa oggi | Cosa manca |
| --- | --- |
| Nome del problema più probabile | Una probabilità misurata, non un giudizio a parole |
| Confidenza alta, media o bassa | La zona della foto che ha portato alla diagnosi |
| Cause probabili e cosa controllare | La verifica che il modello guardi la lesione e non lo sfondo |
| Cura in tre tempi | Esempi simili già diagnosticati, da confrontare a occhio |
| Rinvio al tecnico Agro | Un criterio chiaro per dire «non lo so» |

La spiegazione attuale è un testo scritto dallo stesso modello che fa la diagnosi. È utile, ma non si può verificare: non c'è modo di sapere se descrive davvero il ragionamento seguito.

**Obiettivo.** Affiancare al modello generalista un classificatore dedicato, con spiegazioni che si possono misurare, e usare il modello generalista solo per tradurle in parole semplici.

---

## 2. Che cosa vuol dire «spiegabile» per un agricoltore

Per chi lavora in campo una spiegazione serve se risponde a quattro domande.

1. **Dove guardi?** La parte della foglia che ha pesato sulla diagnosi, evidenziata sulla foto.
2. **Cosa hai visto?** I sintomi in parole: macchie brune, alone giallo, muffa sulla pagina inferiore.
3. **Quanto sei sicuro, e cos'altro potrebbe essere?** Una percentuale affidabile e le due alternative più vicine.
4. **Cosa cambierebbe la diagnosi?** Il controllo da fare per confermarla o escluderla.

Una mappa di calore da sola non basta: dice dove, non cosa. Per questo la guida combina quattro tipi di spiegazione.

| Tipo | Risponde a | Metodo | Costo |
| --- | --- | --- | --- |
| Mappa di attenzione | Dove guardi? | Grad-CAM, Integrated Gradients, occlusione | Basso |
| Sintomi riconosciuti | Cosa hai visto? | Modello con concetti intermedi | Medio: servono etichette dei sintomi |
| Casi simili | È come quelli già visti? | Ricerca per somiglianza negli esempi di addestramento | Basso |
| Controfattuale | Cosa cambierebbe? | Classe alternativa più vicina e sintomo che le distingue | Medio |

---

## 3. Architettura

```
Foto dal telefono
      │
      ▼
1. Controllo della foto ──► sfocata, buia, non è una pianta ──► «Rifai la foto così…»
      │
      ▼
2. Ritaglio della foglia o dell'organo (segmentazione)
      │
      ▼
3. Classificatore ──► probabilità calibrate per coltura e malattia
      │
      ├──► 4a. Mappa di attenzione sulla foto
      ├──► 4b. Sintomi riconosciuti (concetti)
      ├──► 4c. Tre casi simili dall'archivio
      └──► 4d. Alternativa più vicina e come distinguerla
      │
      ▼
5. Regola di astensione ──► incerto o fuori dai casi noti ──► tecnico Agro
      │
      ▼
6. Testo per l'agricoltore (modello generalista, vincolato ai risultati 3-5)
      │
      ▼
Scheda «Diagnosi da foto»
```

Il punto 6 è la differenza rispetto a oggi: il modello generalista non decide più la diagnosi, la racconta. Riceve classe, probabilità, sintomi e alternative, e deve restare dentro quei dati.

---

## 4. I dati

### Raccolte pubbliche

| Raccolta | Contenuto | Limite |
| --- | --- | --- |
| PlantVillage | Circa 54.000 foto di foglie, 14 colture, 38 classi | Foto in laboratorio, sfondo uniforme: i modelli imparano lo sfondo |
| PlantDoc | Circa 2.600 foto prese in campo, 27 classi | Poche immagini per classe |
| Raccolte per singola coltura (vite, olivo, pomodoro, agrumi) | Variabile | Licenze e qualità da verificare una per una |

Numeri e licenze vanno controllati sulle pagine ufficiali prima dell'uso commerciale.

Un modello addestrato solo su PlantVillage supera il 99% sulle foto di prova della stessa raccolta e crolla sulle foto di campo. È il motivo principale per cui la spiegabilità qui non è un abbellimento: è lo strumento che fa vedere il problema.

### Dati propri

Le foto che servono davvero sono quelle delle aziende clienti, nelle condizioni reali.

- **Raccolta.** Ogni foto caricata nella scheda Diagnosi, con il consenso dell'azienda, entra in un archivio con coltura, data, comune e fase della pianta.
- **Etichetta.** La conferma arriva dal tecnico Agro dopo il sopralluogo o da un'analisi di laboratorio. Senza conferma la foto non entra nell'addestramento.
- **Sintomi.** Per ogni foto confermata il tecnico segna i sintomi presenti da un elenco chiuso (vedi 6.2) e, su un campione, disegna il contorno della lesione.
- **Classi da non dimenticare.** «Pianta sana», «danno non da malattia» (sete, carenza, scottatura, fitotossicità, grandine) e «non riconoscibile».

### Divisione dei dati

Addestramento, validazione e prova vanno separati **per azienda e per annata**, non per singola foto. Se foto dello stesso campo finiscono in gruppi diversi, il risultato sembra migliore di quanto è.

---

## 5. Il classificatore

Si parte da un modello già addestrato su immagini generiche e lo si adatta.

```python
import timm, torch

N_CLASSI = 40  # coltura + malattia, più sana, danno abiotico, non riconoscibile

modello = timm.create_model("convnext_tiny", pretrained=True, num_classes=N_CLASSI)

# Durante l'addestramento: variazioni che imitano il campo
# luce, sfocatura, rotazione, ritaglio, e sostituzione dello sfondo
# (lo sfondo sostituito impedisce al modello di impararlo)
```

Scelte consigliate:

- **Rete.** ConvNeXt o EfficientNet di taglia piccola: bastano, e le mappe di attenzione sono più leggibili di quelle dei modelli più grandi.
- **Ingresso.** La foglia ritagliata, non la foto intera (punto 2 dell'architettura).
- **Uscita gerarchica.** Prima la coltura, poi la malattia: la coltura è già nota dalla scheda Azienda e si può imporre.
- **Calibrazione.** Dopo l'addestramento si corregge la sicurezza del modello con la scalatura di temperatura sul gruppo di validazione. Senza questo passaggio il «92%» mostrato all'agricoltore non significa 92 casi giusti su 100.

```python
# Scalatura di temperatura: un solo parametro T, stimato sulla validazione
logit_calibrati = logit / T
probabilita = torch.softmax(logit_calibrati, dim=1)
```

---

## 6. Le spiegazioni

### 6.1 Mappa di attenzione: dove guarda

Grad-CAM colora le zone della foto che hanno fatto salire la probabilità della classe scelta.

```python
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
from pytorch_grad_cam.utils.image import show_cam_on_image

cam = GradCAM(model=modello, target_layers=[modello.stages[-1]])
mappa = cam(input_tensor=x, targets=[ClassifierOutputTarget(classe)])[0]   # valori tra 0 e 1
sovrapposta = show_cam_on_image(foto_rgb_0_1, mappa, use_rgb=True)
```

Tre accorgimenti:

- **Due metodi, non uno.** Affiancare a Grad-CAM un metodo diverso (Integrated Gradients con la libreria Captum, oppure l'occlusione: si copre un riquadro alla volta e si misura quanto scende la probabilità). Se le due mappe non concordano, la spiegazione non è affidabile e va detto.
- **Mappa anche per l'alternativa.** Mostrare la mappa della seconda classe più probabile aiuta a capire cosa le distingue.
- **Forma semplice.** All'agricoltore non si mostra la mappa a colori: si disegna un contorno intorno alla zona che supera una soglia, con la scritta «Ho guardato qui».

### 6.2 Sintomi riconosciuti: cosa ha visto

Un modello «a concetti» non passa direttamente dalla foto alla malattia: prima riconosce i sintomi, poi dai sintomi ricava la diagnosi.

```
foto ──► sintomi (macchie brune 0,91 · alone giallo 0,78 · muffa bianca 0,12 …) ──► malattia
```

Elenco iniziale dei sintomi, da rivedere con un fitopatologo:

| Gruppo | Sintomi |
| --- | --- |
| Macchie | Brune, nere, giallo-olio, con anelli concentrici, con alone giallo, angolari tra le nervature |
| Muffe e patine | Bianca polverosa, grigia, lanuginosa sulla pagina inferiore |
| Colore | Ingiallimento diffuso, tra le nervature, dei margini; arrossamento; mosaico |
| Forma | Accartocciamento, bollosità, arricciamento, nanismo |
| Tessuto | Disseccamento dei margini, marciume molle, cancro, fori |
| Presenze | Insetti visibili, uova, rosure, gallerie, melata |

Vantaggi:

- La spiegazione è scritta nel linguaggio dell'agricoltore: «macchie brune con anelli concentrici» si verifica a occhio.
- Il tecnico può **correggere un sintomo** («non c'è muffa») e il modello ricalcola la diagnosi. È la forma più utile di collaborazione tra persona e modello.
- Gli errori si localizzano: sintomo riconosciuto male, oppure sintomi giusti e diagnosi sbagliata.

Il costo è l'etichettatura dei sintomi (sezione 4). Se all'inizio non c'è, si parte con 6.1 e 6.3 e si aggiunge questo livello appena ci sono qualche migliaio di foto etichettate.

### 6.3 Casi simili: è come quelli già visti

Per ogni foto si cercano le tre immagini più simili tra quelle confermate, usando il vettore che la rete calcola prima dell'ultimo strato.

```python
vettore = modello.forward_head(modello.forward_features(x), pre_logits=True)
simili = indice.search(vettore, k=3)   # indice costruito sulle foto confermate
```

Si mostrano all'agricoltore con coltura, diagnosi confermata e mese: «Tre casi simili, tutti confermati come peronospora». Se i tre casi appartengono a classi diverse, è un segnale di incertezza da dichiarare.

### 6.4 Controfattuale: cosa cambierebbe la diagnosi

Dalla seconda classe più probabile si ricava la frase che manca oggi:

> Potrebbe essere anche **alternaria**. Le distingue questo: nell'alternaria le macchie hanno anelli concentrici e non c'è muffa sulla pagina inferiore. Gira la foglia e controlla al mattino presto.

Con il modello a concetti la frase si costruisce dai sintomi che differiscono di più tra le due classi. Senza, si usa una tabella scritta dal fitopatologo: per ogni coppia di malattie che si confondono, il sintomo che le separa e il controllo da fare.

---

## 7. Quando il modello deve dire «non lo so»

Tre controlli, tutti prima di mostrare una diagnosi.

| Controllo | Come | Cosa succede |
| --- | --- | --- |
| Foto inadatta | Sfocatura, luce, presenza di una foglia nel ritaglio | Si chiede di rifare la foto, con un consiglio preciso |
| Caso mai visto | Distanza del vettore dagli esempi di addestramento oltre una soglia | «Non è tra i casi che conosco»: richiesta al tecnico Agro |
| Incertezza | Probabilità calibrata sotto soglia, oppure prime due classi troppo vicine | Si mostrano entrambe le ipotesi e il controllo che le separa |

Le soglie si fissano sui dati di validazione scegliendo quanto errore è accettabile. Esempio di criterio: tra le diagnosi mostrate come «sicure», al massimo 5 su 100 sbagliate; tutto il resto passa al tecnico.

Un'astensione ben fatta è parte della spiegabilità: l'agricoltore si fida di più di uno strumento che sa dove finisce la sua competenza.

---

## 8. Verificare che le spiegazioni siano vere

Una spiegazione convincente può essere falsa. Prima di mostrarla agli utenti vanno fatte queste prove.

| Prova | Domanda | Come si fa |
| --- | --- | --- |
| Aderenza alla lesione | La mappa cade sulla parte malata? | Quota della zona evidenziata che sta dentro il contorno disegnato dal tecnico |
| Cancellazione | Le zone evidenziate contano davvero? | Si oscurano per prime le zone più evidenziate: la probabilità deve scendere in fretta |
| Sfondo | Il modello guarda lo sfondo? | Si sostituisce lo sfondo: la diagnosi non deve cambiare |
| Pesi casuali | La mappa dipende dal modello? | Con i pesi della rete rimescolati la mappa deve cambiare; se resta uguale, sta solo seguendo i bordi |
| Stabilità | La spiegazione regge a piccoli cambiamenti? | Stessa foglia, luce o inquadratura leggermente diverse: mappa e sintomi devono restare simili |
| Prova con le persone | La spiegazione aiuta a decidere meglio? | Tecnici e agricoltori giudicano casi con e senza spiegazione: si misura quante volte riconoscono un errore del modello |

L'ultima è la più importante. Una spiegazione riuscita non è quella che fa fidare di più, ma quella che fa fidare **quando il modello ha ragione e dubitare quando sbaglia**.

### Misure da tenere sotto controllo

| Misura | Obiettivo iniziale |
| --- | --- |
| Accuratezza su foto di campo di aziende mai viste | Dichiarata per coltura, non una media unica |
| Errore di calibrazione | Sotto il 5% |
| Diagnosi «sicure» sbagliate | Al massimo 5 su 100 |
| Quota di casi passati al tecnico | Da misurare: troppo alta rende inutile lo strumento |
| Aderenza della mappa alla lesione | Sopra il 60% |
| Errori del modello riconosciuti dall'utente grazie alla spiegazione | In crescita rispetto alla versione senza spiegazione |

Gli obiettivi sono punti di partenza ragionevoli, da rivedere con i primi dati.

---

## 9. Collegamento con Agro

### Servizio

Il modello gira in un servizio separato in Python; il server Node di Agro lo chiama come fa oggi con l'IA.

```
POST /api/diagnosi
  ingresso: foto, coltura, comune, mese, nota dell'agricoltore
  uscita:   JSON qui sotto
```

```json
{
  "foto_ok": true,
  "astensione": null,
  "diagnosi": { "classe": "peronospora_pomodoro", "nome": "Peronospora del pomodoro", "probabilita": 0.87 },
  "alternative": [ { "nome": "Alternaria", "probabilita": 0.09, "come_distinguere": "Anelli concentrici, nessuna muffa sotto la foglia" } ],
  "dove": { "contorni": [[[0.31, 0.42], [0.48, 0.40], [0.50, 0.61]]], "metodi_concordi": true },
  "sintomi": [ { "nome": "Macchie brune irregolari", "sicurezza": 0.91 }, { "nome": "Muffa chiara sulla pagina inferiore", "sicurezza": 0.74 } ],
  "casi_simili": [ { "id": "a1f3", "diagnosi": "Peronospora del pomodoro", "mese": "maggio" } ],
  "versione_modello": "2027.03"
}
```

### Interfaccia

La scheda esistente si arricchisce senza cambiare struttura:

- **In alto.** La foto con il contorno «Ho guardato qui» e, a richiesta, la mappa completa.
- **Sintomi.** Una riga di etichette toccabili: l'agricoltore o il tecnico può togliere un sintomo che non vede, e la diagnosi si aggiorna.
- **Sicurezza.** La percentuale calibrata al posto di «alta, media, bassa», con la frase «su 100 casi come questo, ne ho azzeccati 87».
- **Potrebbe essere anche.** L'alternativa con il controllo che la distingue.
- **Casi simili.** Tre miniature confermate.
- **Se serve, interveniamo noi.** Resta com'è; diventa la via principale quando il modello si astiene.

### Il testo

Il modello generalista riceve il JSON e scrive cause, controlli e cura come oggi, con una regola in più nel prompt: non cambiare diagnosi, probabilità e sintomi, e non aggiungere sintomi che non sono nell'elenco.

### Ritorno dei dati

Ogni correzione di un sintomo, ogni conferma o smentita del tecnico e ogni esito di laboratorio torna nell'archivio con la versione del modello. È il materiale per il riaddestramento e per la verifica periodica delle misure della sezione 8.

---

## 10. Piano di lavoro

| Fase | Durata indicativa | Cosa si fa | Si passa oltre se |
| --- | --- | --- | --- |
| 1. Base | 4-6 settimane | Due o tre colture (pomodoro, vite, olivo); classificatore su raccolte pubbliche più prime foto di campo; Grad-CAM e occlusione | L'accuratezza su foto di campo è dichiarabile e le mappe superano le prove di sfondo e pesi casuali |
| 2. Fiducia | 4 settimane | Calibrazione, astensione, casi simili, alternativa con controllo | Le diagnosi «sicure» sbagliate sono entro l'obiettivo |
| 3. Sintomi | 8-10 settimane | Etichettatura dei sintomi con il tecnico; modello a concetti; correzione dei sintomi nell'interfaccia | I sintomi riconosciuti concordano con quelli del tecnico |
| 4. Prova con gli utenti | 4 settimane | Confronto con e senza spiegazione su aziende pilota | Gli utenti riconoscono più errori del modello con la spiegazione |
| 5. Altre colture | Continuo | Una coltura alla volta, con le stesse prove | — |

Le durate sono stime per una persona esperta di apprendimento automatico affiancata da un tecnico agronomo.

---

## 11. Rischi

| Rischio | Conseguenza | Contromisura |
| --- | --- | --- |
| Il modello impara lo sfondo o la luce | Funziona in prova, sbaglia in campo | Ritaglio della foglia, sostituzione dello sfondo, prove della sezione 8 |
| Mappa convincente ma non fedele | Fiducia mal riposta | Due metodi a confronto; prove di cancellazione e pesi casuali |
| Sicurezza non calibrata | Percentuali fuorvianti | Scalatura di temperatura, ricontrollata a ogni riaddestramento |
| Malattia nuova o rara | Diagnosi sbagliata data con sicurezza | Rilevamento dei casi mai visti e astensione |
| Sintomi simili da cause diverse (malattia, carenza, sete) | Trattamento inutile | Classe «danno non da malattia»; alternativa sempre mostrata |
| Etichette sbagliate nei dati | Il modello impara errori | Solo foto confermate da sopralluogo o laboratorio |
| Consiglio di trattamento | Responsabilità verso l'agricoltore | Il modello indica la categoria di intervento; prodotto e dose restano al tecnico abilitato |
| Foto con persone o dati dell'azienda | Riservatezza | Consenso esplicito; ritaglio della sola pianta prima dell'archiviazione |

---

## 12. Strumenti

| Scopo | Strumento |
| --- | --- |
| Addestramento | PyTorch, timm |
| Mappe di attenzione | pytorch-grad-cam, Captum |
| Ritaglio della foglia | Un modello di segmentazione già addestrato, adattato alle foglie |
| Ricerca dei casi simili | FAISS |
| Calibrazione e misure | scikit-learn, torchmetrics |
| Servizio | FastAPI |

Versioni e licenze vanno verificate al momento dell'installazione.

---

## In sintesi

1. Un classificatore dedicato sostituisce il modello generalista nella decisione; il generalista resta per scrivere il testo.
2. Ogni diagnosi esce con quattro spiegazioni: dove, cosa, quanto sicuro e cos'altro, cosa controllare.
3. Il modello si astiene quando la foto è inadatta, il caso è nuovo o è incerto, e passa la mano al tecnico Agro.
4. Le spiegazioni si mettono alla prova prima di mostrarle: devono essere fedeli al modello e aiutare le persone a riconoscerne gli errori.
5. Le correzioni di agricoltori e tecnici tornano nei dati e migliorano il modello a ogni stagione.
