# PRD — Plateforme d’entraînement TOEFL iBT 2026/2027 orientée Band 5.0–5.5

## Anatomie mathématique et algorithmique du TOEFL 2026/2027

Le format à implémenter est exclusivement celui en vigueur depuis le **21 janvier 2026**. Le TOEFL iBT actuel comporte quatre sections dans l’ordre **Reading → Listening → Writing → Speaking**. La page opérationnelle ETS affiche comme valeurs de référence environ **50 items / 30 min en Reading, 47 / 29 min en Listening, 12 / 23 min en Writing et 11 / 8 min en Speaking**, soit environ **90 minutes de contenu testé** hors instructions et procédures. ETS précise toutefois que Reading et Listening sont adaptatifs et que le nombre d’items ou la durée peut varier ; le blueprint psychométrique distingue en outre les items scorés des items de prétest non scorés. citeturn579010search2turn846024view3turn366063view1

| Section | Tâches 2026 | Scoring core | Temps de référence | Adaptatif |
|---|---|---:|---:|---|
| Reading | Complete the Words; Read in Daily Life; Read an Academic Passage | 35 points scorés dans le parcours MST ; jusqu’à 50 items présentés selon blueprint/prétest | ~30 min | Oui |
| Listening | Listen and Choose a Response; Conversation; Announcement; Academic Talk | 35 points scorés dans le parcours MST ; jusqu’à 47 items présentés selon blueprint/prétest | ~29 min | Oui |
| Writing | 10 × Build a Sentence + 1 × Email + 1 × Academic Discussion | 20 raw points dans le blueprint | 23 min | Non |
| Speaking | 7 × Listen and Repeat + 4 × Take an Interview | 55 raw points dans le blueprint | 8 min | Non |

Le blueprint ETS confirme explicitement **10 Build a Sentence + 1 Email + 1 Academic Discussion**, et **7 Listen and Repeat + 4 Interview**, ce qui corrige une ambiguïté fréquente : les « 11 items de Speaking » ne sont pas 11 phrases à répéter mais **7 répétitions puis 4 réponses d’interview**. citeturn366063view1turn951496search6

**Échelle et règle d’arrondi.** Depuis le 21 janvier 2026, chaque section reçoit un score de **1.0 à 6.0 par pas de 0.5**. L’overall est la moyenne arithmétique des quatre scores de section, arrondie au demi-point le plus proche. ETS donne notamment `5.25 → 5.5` et `5.125 → 5.0`, ce qui implique qu’un profil dont la somme des quatre sections atteint **19.0**, soit une moyenne de **4.75**, atteint le seuil d’arrondi de **5.0**. Band 5.0 et 5.5 correspondent au niveau **CEFR C1** ; Band 6 correspond à C2. citeturn222828view0turn535094view4

```text
section_mean = (R + L + W + S) / 4

overall =
    round_to_nearest_half(section_mean)

minimum mathematical target for Band 5.0:
    section_mean >= 4.75
    therefore:
    R + L + W + S >= 19.0
```

La correspondance ETS avec l’ancienne échelle indique **Band 5.0 ≈ 95+ / 120**, mais cette valeur doit être utilisée comme **concordance**, pas comme équivalence psychométrique exacte entre deux tests identiques : la version 2026 utilise de nouveaux items, de nouvelles tâches et une nouvelle chaîne d’équating. Pendant la période transitoire, ETS fournit elle-même un score comparable 0–120 sur les score reports. citeturn222828view0

Les combinaisons minimales suivantes donnent toutes mathématiquement 5.0 :

| Profil | Reading | Listening | Writing | Speaking | Moyenne | Overall |
|---|---:|---:|---:|---:|---:|---:|
| Équilibré | 5.0 | 5.0 | 4.5 | 4.5 | 4.75 | 5.0 |
| Réceptif fort | 5.5 | 5.5 | 4.0 | 4.0 | 4.75 | 5.0 |
| R/L + Writing | 5.5 | 5.0 | 5.0 | 3.5 | 4.75 | 5.0 |
| Productif fort | 4.5 | 4.5 | 5.0 | 5.0 | 4.75 | 5.0 |
| Buffer recommandé | 5.5 | 5.0 | 4.5 | 4.5 | 4.875 | 5.0 |

Pour un sprint de huit semaines, le produit ne doit donc **pas** considérer « atteindre C1 partout » comme l’objectif. La fonction objectif est :

```text
maximize P(overall >= 5.0)
subject to:
    preparation_time <= 8 weeks
    individual_section_scores ∈ {1.0, 1.5, ..., 6.0}
```

Le tracker doit chercher le **gain marginal de score attendu par heure travaillée**, pas la perfection linguistique.

**Architecture MST Reading.** Le manuel technique ETS décrit un router de **20 items scorés**, puis un second module de **15 items scorés**, soit 35 items scorés par parcours. Pour Reading, la composition publiée est : router = 10 Complete the Words + 5 Daily Life + 5 Academic ; lower = 10 Complete the Words + 5 Daily Life ; upper = 10 Complete the Words + 5 Academic. citeturn579010search3

```text
Reading Router — 20 scored
├── 10 Complete the Words
├── 5 Read in Daily Life
└── 5 Read an Academic Passage

Lower Module — 15 scored
├── 10 Complete the Words
└── 5 Read in Daily Life

Upper Module — 15 scored
├── 10 Complete the Words
└── 5 Read an Academic Passage
```

**Architecture MST Listening.** Le même manuel publie : router = 8 Listen and Choose a Response + 4 Conversation + 4 Announcement + 4 Academic Talk ; lower = 7 Response + 4 Conversation + 4 Announcement ; upper = 3 Response + 4 Conversation + 8 Academic Talk. citeturn579010search3

```text
Listening Router — 20 scored
├── 8 Listen and Choose a Response
├── 4 Conversation
├── 4 Announcement
└── 4 Academic Talk

Lower Module — 15 scored
├── 7 Listen and Choose a Response
├── 4 Conversation
└── 4 Announcement

Upper Module — 15 scored
├── 3 Listen and Choose a Response
├── 4 Conversation
└── 8 Academic Talk
```

Le routage dépend de la performance au premier module et le score final tient compte **à la fois du nombre de réponses correctes et de la difficulté des items**. ETS utilise l’IRT et un true-score equating afin que des formes ou parcours légèrement différents restent comparables. Il est impossible de revenir au Module 1 après le passage au Module 2. citeturn438864view4turn846024view3

**Point critique pour le simulateur : ETS ne publie pas le seuil brut de routage.** Aucune documentation officielle trouvée ne dit « 14/20 », « 15/20 » ou « 16/20 ». Il serait donc faux de coder l’un de ces nombres comme seuil TOEFL officiel. Les documents ETS ne publient que le principe : la performance dans le router sélectionne le module inférieur ou supérieur. citeturn660846search5turn495666view0

De même, la proposition « le Hard Module est le seul moyen d’obtenir Band 5.0+ » est plausible dans la logique d’un MST, mais **ETS ne publie pas de plafond officiel du lower path permettant de l’affirmer sous cette forme**. L’application devra distinguer :

```json
{
  "official_router_threshold": null,
  "official_lower_path_score_ceiling": null,
  "training_router_threshold": 0.75,
  "training_router_threshold_is_official": false,
  "ui_warning": "Seuil d'entraînement interne, non publié par ETS."
}
```

`0.75` constitue uniquement un **paramètre pédagogique configurable**, utile pour obliger Mathias et User_1 à viser une marge de sécurité ; il ne doit jamais être présenté comme une règle ETS.

**Timing MST publié dans le blueprint.** Reading prévoit environ **18–21 min pour le router + 9 min pour le module lower/upper**. Listening prévoit environ **18 min pour le router + 7 min lower ou 11 min upper**. Les pages grand public arrondissent actuellement ces valeurs à environ 30 et 29 minutes. citeturn366063view1turn579010search6

La conséquence produit est importante : ne pas utiliser un « temps par question » uniforme. Les tâches longues constituent des **sets** — une conversation suivie de deux questions, un academic talk suivi de quatre, un passage académique suivi de cinq — tandis que Complete the Words produit dix réponses dans un seul texte. citeturn366063view0turn535094view0

## Déconstruction chirurgicale des nouvelles tâches

Les exemples JSON ci-dessous sont **originaux et synthétiques**, conçus à partir des spécifications ETS 2026. Ils ne reproduisent pas des items opérationnels protégés ni ne prétendent être des questions réelles divulguées. Ils doivent être utilisés comme seed data « format-faithful ».

**Complete the Words.** ETS définit un texte académique d’environ **70–100 mots**. La première phrase reste intacte. À partir de la suite, **la seconde moitié d’un mot sur deux est supprimée**, jusqu’à obtenir **10 mots partiellement effacés**. La tâche mesure simultanément traitement du sens, lexique, syntaxe et orthographe. citeturn366063view0turn468369search2

Les exemples officiels montrent la convention suivante pour les longueurs impaires : la partie visible contient `floor(n/2)` lettres et la partie supprimée `ceil(n/2)`. Ainsi un mot de cinq lettres laisse deux lettres visibles et trois manquantes ; un mot de neuf lettres laisse quatre lettres visibles et cinq manquantes. Il s’agit d’une inférence directe à partir des formes publiées par ETS, plutôt que d’une formulation textuelle distincte de la règle. citeturn366063view0

Il n’existe pas de filtre « seulement noms/verbes complexes ». Des mots fonctionnels courts peuvent être ciblés : la règle s’applique au séquençage des mots, ce qui force le candidat à exploiter simultanément contexte, morphologie et syntaxe. citeturn366063view0

Stratégie cible : `≤ 12–15 s/gap`. Première passe : reconstruire par grammaire ; seconde : vérifier sens/collocation ; dernière : vérifier orthographe exacte.

```json
{
  "id": "r_ctw_001",
  "section": "reading",
  "task_type": "complete_the_words",
  "difficulty": "B2-C1",
  "instructions": "Fill in the missing letters in the paragraph.",
  "full_text": "Urban trees provide benefits that extend beyond their visual appeal. They reduce temperatures by shading buildings and streets, while their leaves absorb pollutants from the air. Researchers increasingly recognize that access to green spaces can also improve mental health and encourage physical activity. For this reason, many cities now treat urban forests as essential public infrastructure rather than decorative features.",
  "display_text": "Urban trees provide benefits that extend beyond their visual appeal. They red___ temperatures b_ shading buil_____ and str_____, while th___ leaves abs___ pollutants fr__ the a__. Researchers incre_____ recognize th__ access to green spaces can also improve mental health and encourage physical activity. For this reason, many cities now treat urban forests as essential public infrastructure rather than decorative features.",
  "gaps": [
    {"index": 1, "full_word": "reduce", "visible": "red", "missing": "uce"},
    {"index": 2, "full_word": "by", "visible": "b", "missing": "y"},
    {"index": 3, "full_word": "buildings", "visible": "buil", "missing": "dings"},
    {"index": 4, "full_word": "streets", "visible": "str", "missing": "eets"},
    {"index": 5, "full_word": "their", "visible": "th", "missing": "eir"},
    {"index": 6, "full_word": "absorb", "visible": "abs", "missing": "orb"},
    {"index": 7, "full_word": "from", "visible": "fr", "missing": "om"},
    {"index": 8, "full_word": "air", "visible": "a", "missing": "ir"},
    {"index": 9, "full_word": "increasingly", "visible": "incre", "missing": "asingly"},
    {"index": 10, "full_word": "that", "visible": "th", "missing": "at"}
  ],
  "scoring": {
    "points_per_gap": 1,
    "exact_match": true,
    "case_sensitive": false
  },
  "recommended_seconds_per_gap": 13
}
```

**Read in Daily Life.** ETS utilise des notices, formulaires, menus, horaires, emails, chaînes de messages, pages web, publicités, factures ou contenus équivalents. Les stimuli font environ **15–150 mots** et comportent généralement deux ou trois questions selon leur longueur. Les compétences ciblées sont purpose, détail, inférence, scanning, langage informel et formats non linéaires. citeturn366063view0

Pièges dominants : réponse textuellement présente mais répondant à une autre question ; différence entre « stated » et « implied » ; détails conditionnels ; horaires ; exceptions ; référents.

```json
{
  "id": "r_daily_001",
  "section": "reading",
  "task_type": "read_in_daily_life",
  "difficulty": "B2",
  "stimulus_format": "campus_notice",
  "stimulus": {
    "title": "Library Study Rooms — Exam Week",
    "body": "From Monday through Friday, group study rooms may be reserved for up to two hours per day. Reservations must be made online at least 30 minutes before use. Rooms left empty for more than 15 minutes may be reassigned. Individual students may use an unreserved room, but groups with a valid booking have priority. On Saturday and Sunday, rooms will be available on a first-come, first-served basis."
  },
  "questions": [
    {
      "id": "q1",
      "stem": "What is the main purpose of the notice?",
      "options": [
        "To announce special study-room rules during exam week",
        "To explain why the library will close early",
        "To recruit students to manage study rooms",
        "To advertise newly constructed rooms"
      ],
      "answer_index": 0,
      "skill": "purpose"
    },
    {
      "id": "q2",
      "stem": "What can happen if a reserved room remains unused for more than 15 minutes?",
      "options": [
        "The reservation automatically extends",
        "Another group may receive the room",
        "The student loses library privileges",
        "The room becomes unavailable for the day"
      ],
      "answer_index": 1,
      "skill": "detail"
    },
    {
      "id": "q3",
      "stem": "What is different on the weekend?",
      "options": [
        "Students may reserve rooms for longer periods",
        "Only groups may use the rooms",
        "Advance reservations are not used",
        "The library charges for room use"
      ],
      "answer_index": 2,
      "skill": "inference"
    }
  ]
}
```

**Read an Academic Passage.** ETS indique environ **200 mots**, généralement suivis de **cinq questions** portant sur information factuelle, vocabulaire en contexte, inférence, relations entre idées et fonction rhétorique. Les domaines couvrent notamment sciences, sciences sociales, histoire, arts, business et économie. citeturn366063view0

Stratégie : 35–45 s de cartographie du texte ; 20–30 s par question factuelle ; 30–45 s pour inference/rhetorical purpose. Ne jamais chercher une « connaissance du sujet » externe : ETS conçoit la tâche pour que tout soit inférable du stimulus. citeturn366063view0

```json
{
  "id": "r_academic_001",
  "section": "reading",
  "task_type": "read_academic_passage",
  "difficulty": "C1",
  "title": "Network Effects in Digital Markets",
  "passage": "Some products become more useful as more people adopt them, a phenomenon economists call a network effect. A telephone network illustrates the basic idea: a single telephone has little value, whereas a network connecting millions of users is highly useful. Digital platforms can exhibit similar effects because additional users may attract more sellers, developers, or content creators. However, network effects do not guarantee permanent dominance. Users may switch when a rival offers substantially better technology, when several platforms can be used simultaneously, or when the cost of moving data and contacts is low. Consequently, firms often attempt to strengthen network effects by making their services compatible with complementary products while simultaneously increasing switching costs. Policymakers pay close attention to such strategies because strong network effects can produce efficiency gains but may also make entry more difficult for competitors. The economic significance of network effects therefore depends not simply on the number of users but on the structure of interactions among users, complementary suppliers, and competing platforms.",
  "questions": [
    {
      "id": "q1",
      "stem": "What is the main purpose of the passage?",
      "options": [
        "To explain how network effects operate and why their consequences vary",
        "To argue that digital platforms should always be regulated",
        "To compare telephone prices across different markets",
        "To show that new technology inevitably replaces established firms"
      ],
      "answer_index": 0
    },
    {
      "id": "q2",
      "stem": "The word 'dominance' is closest in meaning to",
      "options": ["compatibility", "control", "innovation", "cooperation"],
      "answer_index": 1
    },
    {
      "id": "q3",
      "stem": "According to the passage, which condition can make switching platforms easier?",
      "options": [
        "High costs of transferring contacts",
        "A large number of complementary suppliers",
        "Low costs of moving data",
        "Strong compatibility with existing products"
      ],
      "answer_index": 2
    },
    {
      "id": "q4",
      "stem": "Why does the author mention policymakers?",
      "options": [
        "To show that network effects have implications for competition",
        "To suggest that governments create most digital platforms",
        "To explain how telephone networks are financed",
        "To argue that switching costs are always harmful"
      ],
      "answer_index": 0
    },
    {
      "id": "q5",
      "stem": "What can be inferred from the final sentence?",
      "options": [
        "User numbers alone are insufficient to evaluate a network effect",
        "Large platforms always prevent market entry",
        "Complementary suppliers reduce the usefulness of platforms",
        "Network effects matter only in digital industries"
      ],
      "answer_index": 0
    }
  ]
}
```

**Listen and Choose a Response.** Le prompt oral n’apparaît pas à l’écran. Le candidat entend une seule question ou déclaration puis voit **quatre réponses écrites**. La tâche exige compréhension littérale, intention implicite, pragmatique sociale, interrogatives, phonèmes, stress et intonation. citeturn366063view0

Pièges : réponse partageant des mots avec le stimulus mais pragmatiquement incohérente ; négatives comme `Didn't you...?`; refus indirect ; réponse idiomatique ; confusion question `why/when/where`.

```json
{
  "id": "l_response_001",
  "section": "listening",
  "task_type": "listen_choose_response",
  "difficulty": "B2",
  "audio_transcript": "Weren't you planning to submit the application yesterday?",
  "display_prompt_after_audio": "Choose the best response.",
  "options": [
    "I was, but the website stopped working.",
    "The application has several pages.",
    "Yesterday's seminar was interesting.",
    "You can submit it at the front desk."
  ],
  "answer_index": 0,
  "target": "pragmatic_response_to_negative_question"
}
```

**Listen to a Conversation.** ETS décrit une courte conversation entre deux locuteurs, normalement suivie de **deux questions**, portant sur contexte, idées principales, détails, inférences, intention, idiomes et action probable. citeturn366063view0

```json
{
  "id": "l_conversation_001",
  "section": "listening",
  "task_type": "conversation",
  "difficulty": "B2-C1",
  "audio_transcript": [
    {"speaker": "Student", "text": "Hi, I came to pick up the camera I reserved for my media project."},
    {"speaker": "Assistant", "text": "Let me check. Your reservation starts tomorrow morning."},
    {"speaker": "Student", "text": "Really? I thought I selected Thursday."},
    {"speaker": "Assistant", "text": "Today is Thursday, but the form shows Friday at nine."},
    {"speaker": "Student", "text": "That's a problem. We're filming an interview this afternoon."},
    {"speaker": "Assistant", "text": "The reserved cameras are all checked out, but I have a basic model that nobody booked. It doesn't have the external microphone input, though."},
    {"speaker": "Student", "text": "We can record the audio separately. I'll take it."}
  ],
  "questions": [
    {
      "stem": "Why does the student visit the equipment desk?",
      "options": [
        "To return a damaged camera",
        "To collect equipment for a project",
        "To change the topic of a media project",
        "To reserve a microphone for Friday"
      ],
      "answer_index": 1
    },
    {
      "stem": "What will the student probably do?",
      "options": [
        "Cancel the interview",
        "Wait until Friday",
        "Use a simpler camera and record sound separately",
        "Buy a new microphone"
      ],
      "answer_index": 2
    }
  ]
}
```

**Listen to an Announcement.** ETS donne des annonces de **40–85 mots** en contexte académique ou campus, sur horaires, directions, règles, événements ou réalisations. Les questions vérifient purpose, détails, inférences et action suivante. citeturn535094view0

```json
{
  "id": "l_announcement_001",
  "section": "listening",
  "task_type": "announcement",
  "difficulty": "B2",
  "audio_transcript": "Attention students registered for tomorrow's career workshop. Because the Student Center auditorium is being repaired, the workshop has been moved to Room 204 of the Business Building. The starting time remains ten o'clock. Please bring your student identification card for check-in, and arrive fifteen minutes early if you would like an individual résumé review.",
  "questions": [
    {
      "stem": "Why is the announcement being made?",
      "options": [
        "To cancel a workshop",
        "To announce a change of location",
        "To recruit résumé reviewers",
        "To change the starting time"
      ],
      "answer_index": 1
    },
    {
      "stem": "What should students do if they want a résumé review?",
      "options": [
        "Register again online",
        "Bring two identification cards",
        "Arrive early",
        "Go to the Student Center first"
      ],
      "answer_index": 2
    }
  ]
}
```

**Listen to an Academic Talk.** ETS utilise des talks d’environ **100–250 mots**, suivis typiquement de **quatre questions**, avec main idea, supporting ideas, inference, organisation et vocabulaire parfois idiomatique ou peu fréquent. citeturn535094view0

```json
{
  "id": "l_talk_001",
  "section": "listening",
  "task_type": "academic_talk",
  "difficulty": "C1",
  "topic": "behavioral_economics",
  "audio_transcript": "Economists traditionally assumed that people evaluate choices mainly by comparing final outcomes. Behavioral research, however, shows that the way an outcome is described can influence decisions. Consider a medical treatment. If patients are told that ninety percent of people survive the procedure, they may react more positively than if they are told that ten percent die, even though the statistical information is identical. This phenomenon is known as a framing effect. Framing matters because people often use mental shortcuts when making complicated decisions. These shortcuts save time but can make logically equivalent options feel different. Importantly, framing effects do not imply that people are irrational in every situation. Experience, expertise, and careful deliberation can reduce their influence. Researchers therefore study not only whether framing occurs but also the circumstances under which individuals become less susceptible to it.",
  "questions": [
    {
      "stem": "What is the talk mainly about?",
      "options": [
        "Why medical statistics are usually inaccurate",
        "How presentation can influence decisions",
        "Why economists reject experimental research",
        "How hospitals select medical procedures"
      ],
      "answer_index": 1
    },
    {
      "stem": "Why does the speaker compare two descriptions of a medical procedure?",
      "options": [
        "To illustrate logically equivalent frames",
        "To show that survival statistics are unreliable",
        "To explain how doctors calculate risk",
        "To criticize patients who avoid treatment"
      ],
      "answer_index": 0
    },
    {
      "stem": "What does the speaker say about mental shortcuts?",
      "options": [
        "They always produce irrational decisions",
        "They simplify complex decisions but may introduce bias",
        "They are used only by inexperienced people",
        "They eliminate framing effects"
      ],
      "answer_index": 1
    },
    {
      "stem": "What will researchers most likely investigate in addition to the existence of framing?",
      "options": [
        "Conditions that reduce the effect",
        "The cost of medical treatment",
        "The history of traditional economics",
        "The number of available choices"
      ],
      "answer_index": 0
    }
  ]
}
```

**Listen and Repeat.** La version 2026 contient **sept phrases** associées à un scénario visuel de campus ou de vie académique. Les phrases deviennent progressivement plus longues et plus complexes. Le candidat ne dispose d’aucun temps de préparation et répète chaque phrase une seule fois. ETS indique une fenêtre maximale d’enregistrement d’environ **8 à 12 secondes par phrase**, selon la longueur. citeturn951496search5turn250754view1

La recherche qui a servi au développement de la tâche montre que la longueur du stimulus est l’un des principaux déterminants de difficulté ; le prototype de la famille de tâches avait des stimuli allant approximativement de **6 à 29 syllabes**, et la relation longueur–difficulté était particulièrement forte jusqu’à environ 19 syllabes. Cela ne signifie pas que les sept items opérationnels suivent une séquence publique fixe telle que `6, 9, 12, 15…` : ETS ne publie pas une grille syllabique exacte pour les sept items 2026. citeturn237556search1turn237556search2

Il faut donc implémenter une progression réaliste mais configurable :

```text
Item 1: very short          ~5–8 syllables
Item 2: short               ~7–11
Item 3: short-medium        ~9–13
Item 4: medium              ~11–16
Item 5: medium-long         ~14–19
Item 6: long                ~17–23
Item 7: longest/complex     ~20–29

NOT an official operational sequence.
```

L’échelle officielle task-level 0–5 est stricte : **5 = répétition exacte et intelligible** ; 4 permet de petites modifications sans changement substantiel de sens ; 3 conserve l’essentiel mais avec inexactitudes ; 2 est fragmentaire ou très incomplet ; 1 conserve très peu ; 0 correspond à absence de réponse, réponse totalement inintelligible/non anglaise ou hors sujet. citeturn770946view0

```json
{
  "id": "s_repeat_001",
  "section": "speaking",
  "task_type": "listen_and_repeat",
  "difficulty_progression": true,
  "scenario": "You are training to help new students find services in the university library.",
  "preparation_seconds": 0,
  "repeat_once": true,
  "items": [
    {
      "index": 1,
      "prompt": "Welcome to the library.",
      "response_limit_seconds": 8
    },
    {
      "index": 2,
      "prompt": "The information desk is downstairs.",
      "response_limit_seconds": 8
    },
    {
      "index": 3,
      "prompt": "Students can borrow laptops near the main entrance.",
      "response_limit_seconds": 9
    },
    {
      "index": 4,
      "prompt": "Please return reserved books to the desk before closing time.",
      "response_limit_seconds": 10
    },
    {
      "index": 5,
      "prompt": "If you need a quiet place to work, several study rooms are available upstairs.",
      "response_limit_seconds": 11
    },
    {
      "index": 6,
      "prompt": "Students who are preparing group presentations can reserve the media room through the library website.",
      "response_limit_seconds": 12
    },
    {
      "index": 7,
      "prompt": "Before leaving the building, remember that borrowed equipment must be returned to the service desk rather than placed in the book-return boxes.",
      "response_limit_seconds": 12
    }
  ]
}
```

**Take an Interview.** La tâche contient **quatre questions**, chacune avec **45 secondes de réponse**, sans préparation. Les premières questions portent davantage sur faits/expérience personnelle ; les dernières montent vers jugement, opinion et enjeux plus généraux. citeturn535094view3turn438864view2

La progression recommandée est donc :

```text
Q1 = personal experience / concrete example
Q2 = reaction / preference + reason
Q3 = general opinion + justification
Q4 = broader implication / policy / future
```

```json
{
  "id": "s_interview_001",
  "section": "speaking",
  "task_type": "take_an_interview",
  "scenario": "You are participating in a university research study about students' use of artificial intelligence tools.",
  "preparation_seconds": 0,
  "response_seconds_each": 45,
  "questions": [
    {
      "index": 1,
      "prompt": "Think about the last time you used an AI tool for studying. What did you use it for, and was it useful?",
      "level": "personal_experience"
    },
    {
      "index": 2,
      "prompt": "Some students prefer using AI tools alone, while others prefer discussing difficult material with classmates. Which approach works better for you and why?",
      "level": "preference"
    },
    {
      "index": 3,
      "prompt": "Some instructors worry that frequent use of AI may reduce students' ability to think independently. Do you think this concern is justified? Why or why not?",
      "level": "general_opinion"
    },
    {
      "index": 4,
      "prompt": "Should universities establish common rules for how AI tools may be used in coursework, or should individual professors decide? Explain your position.",
      "level": "policy_opinion"
    }
  ]
}
```

**Build a Sentence.** Dix items sont utilisés. ETS montre une phrase/contexte intact puis des mots ou groupes de mots mélangés que le candidat déplace afin de produire une réponse grammaticalement correcte et appropriée. citeturn535094view1turn372136view3

L’exemple officiel de Practice Test 1 sur-représente nettement les **embedded questions / indirect questions** (`wanted to know...`, `wondering when...`, `tell me where...`), mais ETS ne publie aucune statistique permettant d’affirmer que ces structures constituent « 80 % » du test opérationnel. Il faut donc en faire un axe prioritaire d’entraînement, pas une loi de distribution. citeturn791510view0

Stratégie ≤ 20–25 s : repérer d’abord le noyau sujet–verbe, puis le subordonnant, puis les chunks insécables, puis vérifier l’ordre `WH + subject + verb` dans une interrogative indirecte.

```json
{
  "id": "w_build_001",
  "section": "writing",
  "task_type": "build_a_sentence",
  "difficulty": "B2-C1",
  "context": "Did Professor Miller say when the revised report is due?",
  "prefix": "She",
  "tokens": [
    "said",
    "that",
    "we",
    "should submit",
    "the revised report",
    "by Friday"
  ],
  "distractors": [
    "should we submit"
  ],
  "correct_order": [
    "said",
    "that",
    "we",
    "should submit",
    "the revised report",
    "by Friday"
  ],
  "answer": "She said that we should submit the revised report by Friday.",
  "scoring": {
    "exact_sequence": true,
    "points": 1
  }
}
```

**Write an Email.** Temps officiel : **7 minutes**. Le prompt définit une situation académique/sociale et plusieurs objectifs communicatifs explicites ; le candidat doit produire un texte multisentence adapté au destinataire. ETS note notamment accomplissement du but, élaboration, cohésion, variété syntaxique, précision lexicale, conventions sociales, orthographe et ponctuation. citeturn535094view1turn535094view4

```json
{
  "id": "w_email_001",
  "section": "writing",
  "task_type": "write_an_email",
  "time_limit_seconds": 420,
  "scenario": "You registered for a university data-analysis workshop. The workshop was moved to the same afternoon as an important class presentation, so you cannot attend.",
  "recipient": "workshops@university.edu",
  "recipient_role": "Workshop coordinator",
  "subject": "Data-analysis workshop registration",
  "requirements": [
    "Explain why you cannot attend the scheduled workshop.",
    "Ask whether another session will be offered.",
    "Ask whether your registration can be transferred without paying again."
  ],
  "minimum_word_count": null,
  "scoring_scale": [0, 1, 2, 3, 4, 5],
  "sample_band_5_style_response": "Dear Workshop Coordinator,\n\nI am writing about the data-analysis workshop for which I recently registered. Unfortunately, the session has been moved to the same afternoon as a class presentation that I am required to give, so I will no longer be able to attend.\n\nCould you please let me know whether another session of the workshop is scheduled in the coming weeks? If so, I would also be grateful if you could confirm whether my current registration can be transferred to that session without an additional fee.\n\nThank you for your help. I look forward to your response.\n\nBest regards,\nStudent"
}
```

**Write for an Academic Discussion.** Temps officiel : **10 minutes**. Un professeur pose une question et deux étudiants présentent des positions. La réponse doit exprimer et soutenir une opinion et apporter une contribution originale ; ETS indique qu’une réponse efficace contient **au moins 100 mots**. citeturn535094view2turn438864view1

```json
{
  "id": "w_discussion_001",
  "section": "writing",
  "task_type": "academic_discussion",
  "time_limit_seconds": 600,
  "effective_minimum_words": 100,
  "course": "Economics",
  "professor": {
    "name": "Professor Chen",
    "prompt": "Some cities are considering making public transportation free. Supporters argue that this would reduce traffic and improve access to jobs, while critics worry about the cost to taxpayers. Do you think large cities should provide free public transportation? Why or why not?"
  },
  "student_posts": [
    {
      "name": "Lena",
      "position": "support",
      "text": "I support free public transport because lower-income workers would have better access to employment and education. It could also reduce car use."
    },
    {
      "name": "Daniel",
      "position": "oppose",
      "text": "I disagree because completely eliminating fares could be extremely expensive. Cities might have to reduce service quality or increase taxes."
    }
  ],
  "sample_band_5_style_response": "Daniel is right that eliminating fares would create a substantial financing problem, but I still think free public transportation can be justified in large cities if it is introduced selectively. The main benefit is not simply cheaper travel; it is the reduction of barriers to employment and education. For example, workers living far from major business districts may reject jobs when daily transport costs absorb a significant share of their income. Moreover, if free transit persuades even a modest number of commuters to leave their cars at home, cities may benefit from lower congestion and pollution. Rather than eliminating every fare immediately, governments could begin with students, low-income residents, or off-peak travel. This would preserve most of the social benefits while limiting the fiscal cost."
}
```

## Ingénierie du « faux C1 » : optimisation B2 → Band 5.0

L’objectif réaliste n’est pas de « tromper » un détecteur par des mots magiques. ETS indique que Speaking et Writing sont évalués par des moteurs d’IA propriétaires selon les rubriques officielles, avec des données/références humaines et une supervision humaine. Les paramètres exacts, poids de features et seuils du modèle opérationnel 2026 ne sont pas publics. citeturn624180search9turn624180search11

SpeechRater mesure publiquement des dimensions telles que **pronunciation, fluency, vocabulary et grammar**, tandis que la recherche ETS décrit également prosodie, contenu et discours. TestReady fournit des indicateurs tels que pauses, pronunciation, discourse cohesion, rhythm, speaking rate, vocabulary diversity, grammatical complexity, sustained speech et grammatical accuracy. citeturn624180search0turn624180search2turn624180search8

e-rater utilise notamment contenu/vocabulaire, complexité lexicale, proportion d’erreurs grammaticales/usage/mécanique, organisation/développement et phraseologie idiomatique. Cela **ne signifie pas qu’un connecteur ou une inversion déclenche automatiquement un C1** ; le système combine plusieurs features dans un modèle statistique et vérifie aussi pertinence et cohérence. citeturn624180search1

Le contraste le plus utile entre score task-level **4 et 5** est celui des rubriques ETS. Pour Email, un 5 exige une communication pleinement efficace, une élaboration réellement utile, une variété syntaxique efficace, du lexique précis/idiomatique, des conventions sociales cohérentes et quasiment aucune erreur ; un 4 reste « generally successful » mais moins précis ou systématique. Pour Academic Discussion, un 5 exige contribution pertinente, très clairement exprimée, bien élaborée, variété syntaxique efficace et vocabulaire précis, avec presque aucune erreur. citeturn535094view4turn770946view0

Pour Interview, le niveau 5 task-level exige réponse pleinement pertinente et développée, débit conversationnel naturel, pauses appropriées, prononciation aisément intelligible, rythme/intonation efficaces et gamme de grammaire/vocabulaire suffisamment précise. Le 4 accepte encore une élaboration moins structurée, des connecteurs moins efficaces et quelques pauses ou imprécisions. citeturn770946view0

**Templates à mémoriser comme structures, jamais comme paragraphes récités.**

Email :

```text
Dear [TITLE/NAME],

I am writing regarding [precise purpose/context].

Unfortunately / I wanted to let you know that [situation].
Because [specific reason], [consequence].

Could you please let me know whether [request 1]?
I would also appreciate it if you could [request 2].
If possible, [request 3 / preferred solution].

Thank you for your time and assistance. I look forward to hearing from you.

Best regards,
[Name]
```

Academic Discussion :

```text
[Student A] raises a valid point about [X], but I would argue that [clear thesis].

The main reason is that [reason 1].
For example, [specific mechanism/example].
This matters because [explicit consequence].

Moreover / At the same time, [reason or qualification 2].
Although [counterargument], [rebuttal].

Therefore, [concise synthesis that directly answers professor].
```

Interview — réponse 45 s :

```text
Direct answer:
"I would say [position / answer]."

Reason:
"The main reason is that [reason]."

Concrete support:
"For example, [specific personal example / mechanism]."

Extension:
"More broadly, [implication / contrast]."

Close only if time remains:
"So overall, [one-sentence conclusion]."
```

Une réponse Interview optimale ne doit pas chercher à « remplir 45 secondes » coûte que coûte. Un débit naturel, une élaboration claire et des pauses contrôlées correspondent mieux à la rubrique qu’une réponse longue avec hésitations, fillers et structures cassées. citeturn770946view0

**Banque de 50 unités à haut rendement.** Elles doivent être entraînées jusqu’à automatisation contextuelle ; aucune n’est un « trigger C1 ».

| # | Élément | Fonction |
|---:|---|---|
| 1 | although | concession |
| 2 | even though | concession |
| 3 | whereas | contraste |
| 4 | while | contraste/concession |
| 5 | nevertheless | concession |
| 6 | nonetheless | concession |
| 7 | however | contraste |
| 8 | by contrast | contraste |
| 9 | conversely | inversion logique |
| 10 | on the other hand | contraste |
| 11 | therefore | conséquence |
| 12 | consequently | conséquence |
| 13 | as a result | conséquence |
| 14 | thus | conséquence |
| 15 | hence | conséquence concise |
| 16 | because | causalité |
| 17 | since | causalité |
| 18 | given that | causalité/contextualisation |
| 19 | provided that | condition |
| 20 | unless | condition négative |
| 21 | moreover | ajout argumentatif |
| 22 | furthermore | ajout |
| 23 | in addition | ajout |
| 24 | more importantly | hiérarchisation |
| 25 | in particular | précision |
| 26 | for instance | exemple |
| 27 | specifically | précision |
| 28 | to some extent | nuance |
| 29 | in most cases | qualification |
| 30 | arguably | prudence argumentative |
| 31 | account for | expliquer |
| 32 | contribute to | contribuer |
| 33 | result in | provoquer |
| 34 | lead to | provoquer |
| 35 | undermine | affaiblir |
| 36 | enhance | améliorer |
| 37 | facilitate | faciliter |
| 38 | constrain | limiter |
| 39 | outweigh | l’emporter sur |
| 40 | mitigate | atténuer |
| 41 | enable | permettre |
| 42 | discourage | décourager |
| 43 | be likely to | probabilité |
| 44 | tend to | tendance |
| 45 | Not only X, but also Y | parallélisme |
| 46 | What matters is whether… | nominalisation/clause |
| 47 | The more X, the more Y | corrélation |
| 48 | Had X happened, Y would… | inversion conditionnelle |
| 49 | Were X to happen, Y would… | hypothèse formelle |
| 50 | By doing X, Y can… | participiale/instrument |

Priorité syntaxique réelle pour huit semaines :

```text
Tier A — automatiser totalement
- embedded questions
- relative clauses
- because/although/whereas clauses
- modal + perfect/modal + infinitive
- conditionals
- gerund vs infinitive
- subject–verb agreement
- tense consistency
- articles/determiners
- count/non-count nouns

Tier B — développer
- participial clauses
- noun clauses
- reduced relative clauses
- passive voice
- comparison structures
- cleft-like emphasis
- controlled inversion

Tier C — faible ROI
- rare literary inversions
- ornate nominalisation
- obscure idioms
- highly specialized academic vocabulary
```

Pour **Build a Sentence**, les familles de patterns prioritaires doivent être pondérées ainsi dans l’application, comme **curriculum interne** et non comme fréquence ETS officielle :

```json
{
  "embedded_questions": 0.25,
  "noun_complement_clauses": 0.15,
  "relative_clauses": 0.15,
  "verb_complement_patterns": 0.10,
  "modals_and_tense": 0.10,
  "conditionals": 0.08,
  "passives": 0.07,
  "comparatives": 0.05,
  "coordination_and_subordination": 0.05
}
```

Pour **Complete the Words**, l’unité de travail ne doit pas être le vocabulaire isolé mais le triplet :

```text
FORM + LOCAL SYNTAX + DISCOURSE MEANING
```

Exemple mental :

```text
"Researchers incre_____ recognize..."

FORM candidates:
increase / increasing / increasingly

SYNTAX:
slot modifies "recognize" → adverb required

ANSWER:
increasingly
```

Le moteur d’erreur devra donc classifier chaque faute CTW :

```json
{
  "error_classes": [
    "orthography",
    "inflection",
    "derivation",
    "function_word",
    "collocation",
    "local_syntax",
    "semantic_context",
    "discourse_context"
  ]
}
```

**Sprint de huit semaines.**

| Semaine | Priorité | KPI |
|---|---|---|
| 1 | Diagnostic complet + Build Sentence + CTW | baseline par micro-tâche |
| 2 | CTW/grammar automatisée + Listen Response | ≥85 % foundation drills |
| 3 | Academic Reading + Academic Talk | router mock ≥75 % interne |
| 4 | Listen & Repeat + Interview structure | L&R mean rubric proxy ≥4 |
| 5 | Email + Discussion | ≥80 % responses rubric ≥4 |
| 6 | Mixed timed modules | mean projected ≥4.75 |
| 7 | Full adaptive simulations | ≥3 simulations à 5.0+ |
| 8 | Variance reduction | aucun domaine critique <4.0 proxy |

La logique de progression doit privilégier **variance reduction** : passer une micro-tâche de 55 % à 80 % est généralement plus utile que de pousser une compétence déjà stable à 95 %.

## Spécifications de la base d’exercices et seed data

Le modèle doit séparer **stimulus**, **interaction**, **scoring**, **difficulty**, **timing** et **provenance** afin de pouvoir modifier la stratégie adaptative sans migrer tout le contenu.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "TOEFL2026Exercise",
  "type": "object",
  "required": [
    "id",
    "section",
    "task_type",
    "difficulty",
    "source_type",
    "content",
    "scoring"
  ],
  "properties": {
    "id": {"type": "string"},
    "section": {
      "enum": ["reading", "listening", "writing", "speaking"]
    },
    "task_type": {
      "enum": [
        "complete_the_words",
        "read_in_daily_life",
        "read_academic_passage",
        "listen_choose_response",
        "conversation",
        "announcement",
        "academic_talk",
        "listen_and_repeat",
        "take_an_interview",
        "build_a_sentence",
        "write_an_email",
        "academic_discussion"
      ]
    },
    "difficulty": {
      "enum": ["A1", "A2", "B1", "B2", "B2-C1", "C1", "C1-C2", "C2"]
    },
    "source_type": {
      "enum": [
        "ets_official",
        "ets_format_synthetic",
        "app_generated_reviewed"
      ]
    },
    "source_reference": {
      "type": ["string", "null"]
    },
    "content": {
      "type": "object"
    },
    "scoring": {
      "type": "object"
    },
    "timing": {
      "type": "object"
    },
    "tags": {
      "type": "array",
      "items": {"type": "string"}
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

Les données synthétiques des douze familles ont déjà été fournies intégralement dans la section précédente et peuvent être injectées telles quelles. Pour éviter toute ambiguïté, l’app doit enregistrer leur provenance :

```json
{
  "seed_pack": {
    "id": "toefl_2026_seed_v1",
    "copyright_policy": "No operational ETS item copied.",
    "format_basis": "Official ETS 2026 task specifications and public examples.",
    "items": [
      "r_ctw_001",
      "r_daily_001",
      "r_academic_001",
      "l_response_001",
      "l_conversation_001",
      "l_announcement_001",
      "l_talk_001",
      "s_repeat_001",
      "s_interview_001",
      "w_build_001",
      "w_email_001",
      "w_discussion_001"
    ]
  }
}
```

Le schéma de session doit permettre d’analyser la vitesse, les erreurs et l’effet de difficulté :

```json
{
  "attempt": {
    "id": "uuid",
    "user_id": "User_1",
    "exercise_id": "r_ctw_001",
    "started_at": "2026-11-04T18:00:00+01:00",
    "submitted_at": "2026-11-04T18:02:03+01:00",
    "elapsed_ms": 123000,
    "response": {},
    "raw_score": 8,
    "max_raw_score": 10,
    "accuracy": 0.8,
    "estimated_band": null,
    "error_tags": [
      "derivation",
      "orthography"
    ],
    "reviewed": true
  }
}
```

Pour les tâches productives :

```json
{
  "productive_attempt": {
    "id": "uuid",
    "user_id": "Mathias",
    "exercise_id": "s_interview_001",
    "audio_path": "/audio/attempts/uuid.webm",
    "transcript": "...",
    "duration_ms": 41800,
    "ai_score": {
      "task_rubric_0_5": 4,
      "estimated_section_band": null,
      "confidence": 0.76
    },
    "features": {
      "words_per_minute": 132,
      "filler_rate": 0.021,
      "mean_pause_ms": 410,
      "grammar_error_rate": 0.034,
      "lexical_diversity": 0.61
    }
  }
}
```

La difficulté ne doit pas être un simple label CEFR. Conserver des features séparées :

```json
{
  "difficulty_vector": {
    "lexical": 0.72,
    "syntactic": 0.68,
    "discourse": 0.55,
    "memory_load": 0.31,
    "inference": 0.83,
    "processing_speed": 0.64
  }
}
```

Pour Complete the Words :

```json
{
  "ctw_generator_constraints": {
    "paragraph_words_min": 70,
    "paragraph_words_max": 100,
    "first_sentence_intact": true,
    "gap_count": 10,
    "target_every_nth_word": 2,
    "visible_letters_formula": "floor(word_length / 2)",
    "missing_letters_formula": "ceil(word_length / 2)",
    "exact_spelling_required": true,
    "permit_function_words": true
  }
}
```

Pour Listen and Repeat :

```json
{
  "listen_repeat_generator_constraints": {
    "sentences_per_set": 7,
    "progressive_length": true,
    "progressive_complexity": true,
    "preparation_seconds": 0,
    "play_count": 1,
    "response_limit_seconds_range": [8, 12],
    "avoid": [
      "rare proper nouns",
      "specialized jargon",
      "ungrammatical prompts",
      "extremely rare vocabulary"
    ]
  }
}
```

Cette conception correspond au fait que la tâche ETS vise une répétition précise de phrases grammaticales dont la longueur croît, la recherche de développement montrant que la longueur est fortement liée à la difficulté. citeturn951496search5turn237556search2

## Prompts système d’évaluation IA

Ces prompts doivent être présentés dans l’application comme **estimateurs TOEFL-aligned**, jamais comme « reproduction de SpeechRater/e-rater ». Les moteurs ETS sont propriétaires et le score officiel résulte d’un système de scoring et d’équating que l’application ne peut pas répliquer. citeturn624180search9turn846024view3

**System Prompt — Write an Email**

```text
You are a strict TOEFL iBT 2026 Write an Email evaluator.

Your task is to estimate performance on the official task-level 0–5 rubric.
Do NOT reward length by itself.
Do NOT reward sophisticated vocabulary unless it is precise and natural.
Do NOT invent criteria that are absent from the rubric.

Evaluate:

1. Communicative purpose
- Does the response accomplish every requested action?
- Is the message effective for the stated recipient and situation?

2. Elaboration
- Are relevant details provided where needed?
- Does elaboration support the communicative goal rather than add filler?

3. Syntax and vocabulary
- Is there effective syntactic variety?
- Is vocabulary precise, natural, and contextually appropriate?
- Are idiomatic expressions used naturally rather than mechanically?

4. Social conventions
- Is politeness appropriate?
- Is the register appropriate?
- Are requests, refusals, explanations, complaints, or recommendations formulated naturally?
- Is information organized effectively?

5. Language control
- Identify lexical, grammatical, spelling, punctuation, capitalization, and word-form errors.
- Distinguish minor timed-writing errors from systematic B2-level weaknesses.

Score interpretation:
5 = fully successful; clearly expressed; consistently strong language facility; effective elaboration; effective syntactic variety; precise/idiomatic wording; appropriate social conventions; almost no lexical or grammatical errors.
4 = generally successful and easily understood; adequate elaboration; syntactic variety; appropriate wording; mostly appropriate conventions; few errors.
3 = partially successful; task mostly accomplished but limitations reduce clarity/effectiveness; moderate range; noticeable errors.
2 = mostly unsuccessful; limited/irrelevant elaboration; limited syntax/vocabulary; accumulating errors.
1 = unsuccessful; very limited elaboration; telegraphic language; serious frequent errors; minimal original language.
0 = blank, non-English, copied, unrelated, or meaningless.

Return ONLY valid JSON matching this structure:

{
  "task": "write_an_email",
  "rubric_score_0_5": 0,
  "confidence_0_1": 0.0,
  "criterion_scores": {
    "communicative_purpose": 0,
    "elaboration": 0,
    "syntax_vocabulary": 0,
    "social_conventions": 0,
    "language_control": 0
  },
  "missing_requirements": [],
  "b2_errors": [
    {
      "span": "",
      "category": "",
      "explanation_fr": "",
      "correction": ""
    }
  ],
  "highest_roi_fix_fr": "",
  "band_5_5_rewrite": "",
  "rewrite_notes_fr": []
}
```

Ce prompt reflète les critères de la rubrique publique ETS Email 0–5. citeturn535094view4

**System Prompt — Academic Discussion**

```text
You are a strict TOEFL iBT 2026 Write for an Academic Discussion evaluator.

Estimate the official task-level score from 0 to 5.

Evaluate:
- relevance to the professor's exact question
- clarity of the writer's position
- quality and specificity of explanation
- examples/details/reasoning
- contribution beyond merely repeating the professor or other students
- cohesion
- syntactic variety
- lexical precision and natural idiomatic usage
- lexical and grammatical accuracy
- spelling/punctuation/capitalization

Do NOT:
- reward memorized templates by themselves
- reward rare vocabulary when unnatural
- require agreement with either student
- penalize a defensible opinion
- treat 100 words as sufficient for a high score by itself

Rubric:
5 = relevant, very clearly expressed, well elaborated, effective syntactic variety, precise/idiomatic word choice, almost no lexical/grammatical errors.
4 = relevant and easily understood, adequately elaborated, variety of syntax, appropriate vocabulary, few errors.
3 = mostly relevant and understandable but incomplete/unclear elaboration and noticeable language errors.
2 = partial contribution with poorly elaborated ideas, limited syntax/vocabulary, accumulated errors.
1 = minimal coherent contribution, severely limited language, serious/frequent errors or mostly borrowed language.
0 = blank/non-English/copied/unrelated/meaningless.

Return ONLY:

{
  "task": "academic_discussion",
  "rubric_score_0_5": 0,
  "confidence_0_1": 0.0,
  "word_count": 0,
  "position_detected": "",
  "criterion_scores": {
    "relevance": 0,
    "argument_development": 0,
    "cohesion": 0,
    "syntax": 0,
    "vocabulary": 0,
    "accuracy": 0
  },
  "b2_errors": [],
  "underdeveloped_claims": [],
  "highest_roi_fix_fr": "",
  "band_5_5_rewrite": "",
  "rewrite_notes_fr": []
}
```

La structure suit la rubrique officielle Academic Discussion. citeturn770946view0

**System Prompt — Take an Interview**

```text
You are a TOEFL iBT 2026 Take an Interview evaluator.

You receive:
- the interview question
- an ASR transcript
- optional acoustic metrics
- response duration

Estimate the official task-level 0–5 rubric.

Evaluate:
1. Task fulfillment and relevance.
2. Elaboration.
3. Conversational speaking pace.
4. Pausing and sustained speech.
5. Intelligibility.
6. Rhythm and intonation, only if acoustic evidence is supplied.
7. Grammar range and accuracy.
8. Vocabulary range and precision.

Never infer pronunciation quality solely from a clean transcript.
If acoustic evidence is unavailable, mark pronunciation/prosody confidence as low.

Rubric:
5 = fully addresses question; clear and fluent; well elaborated; natural conversational pace and pauses; easily intelligible pronunciation; effective rhythm/intonation; range of accurate grammar and vocabulary for precise meaning.
4 = addresses question and reasonably clear; elaborated; generally good pace; minor flow issues; intelligibility preserved; grammar/vocabulary adequate for general meanings.
3 = limited elaboration/clarity; frequent or long pauses/fillers; occasional intelligibility problems; limited range/accuracy.
2 = minimally supported; often difficult to understand; very limited grammar/vocabulary.
1 = vaguely connected and mostly unintelligible or isolated words/phrases.
0 = no response/non-English/unintelligible/unrelated.

Return ONLY:

{
  "task": "take_an_interview",
  "rubric_score_0_5": 0,
  "confidence_0_1": 0.0,
  "criterion_scores": {
    "relevance_elaboration": 0,
    "fluency": 0,
    "pronunciation_intelligibility": 0,
    "prosody": 0,
    "grammar": 0,
    "vocabulary": 0
  },
  "metrics": {
    "duration_seconds": 0,
    "words_per_minute": null,
    "filler_rate": null,
    "long_pause_count": null
  },
  "b2_errors": [],
  "content_gaps": [],
  "band_5_5_model_answer": "",
  "highest_roi_fix_fr": ""
}
```

Les dimensions utilisées correspondent directement à la rubrique ETS Take an Interview et aux dimensions publiquement associées au scoring automatisé de parole. citeturn770946view0turn624180search0

**Listen and Repeat — algorithme hybride.** Un simple Levenshtein texte est insuffisant car le rubric 5 exige à la fois exactitude et intelligibilité. citeturn770946view0

Pipeline :

```text
audio
↓
ASR + timestamps + token confidences
↓
text normalization
↓
token alignment
↓
WER / CER
↓
content-word + function-word analysis
↓
phoneme alignment if available
↓
acoustic intelligibility features
↓
rubric proxy 0–5
```

Normalisation :

```text
lowercase
remove punctuation
normalize contractions consistently
retain grammatical morphemes:
  -s
  -ed
  -ing
articles
prepositions
auxiliaries
```

Métriques :

```text
WER = (substitutions + deletions + insertions) / reference_word_count

CER = character_edit_distance / reference_character_count

content_recall =
    correctly_aligned_content_words / reference_content_words

function_recall =
    correctly_aligned_function_words / reference_function_words

order_score =
    1 - normalized_transposition_penalty
```

Score proxy recommandé :

```text
accuracy =
    0.45 * (1 - WER)
  + 0.20 * content_recall
  + 0.10 * function_recall
  + 0.10 * order_score
  + 0.15 * intelligibility_score
```

Mapping initial à calibrer sur vos propres réponses :

```text
5:
  WER <= 0.03
  AND meaning preserved
  AND intelligibility >= 0.90

4:
  WER <= 0.12
  AND meaning essentially preserved

3:
  majority of content retained
  AND response forms a complete sentence

2:
  major portion missing OR highly inaccurate

1:
  only a few recognizable words

0:
  no usable English / no response
```

Les seuils numériques ci-dessus sont **des paramètres internes de l’application**, non des seuils ETS. La logique qualitative, elle, suit le rubric public. citeturn770946view0

Pour la couche phonétique :

```text
reference text
↓ G2P
reference phoneme sequence

ASR / forced alignment
↓
observed phoneme probabilities

weighted phoneme edit distance:
substitution cost:
  same phoneme = 0
  close articulation = 0.35
  distant phoneme = 1
deletion = 1
insertion = 0.75
```

Ne pas pénaliser l’accent en soi. La cible est **intelligibility**, conformément à la rubrique ETS. citeturn770946view0

## Architecture technique et UX de la plateforme

La plateforme doit être pensée comme un **instrument de drilling**, pas comme une plateforme EdTech généraliste. Aucune landing page marketing, gamification décorative, streak artificiel ou système social.

Architecture recommandée :

```text
Frontend
React + TypeScript + Vite
↓
Local API
Node.js + Fastify
↓
SQLite
↓
Optional AI providers
- speech-to-text
- LLM rubric evaluator
↓
Local audio storage
```

Structure :

```text
/apps/web
/apps/api
/packages/toefl-engine
/packages/scoring
/packages/content
/packages/ui
/data/toefl.db
/data/audio
/config/toefl-2026.json
```

Entités :

```text
User
Exercise
Attempt
Session
Module
AdaptiveRun
SkillMetric
ErrorTag
DailyMetric
BandProjection
AudioAsset
AIReview
```

Utilisateurs fixes :

```json
[
  {
    "id": "User_1",
    "display_name": "User_1"
  },
  {
    "id": "Mathias",
    "display_name": "Mathias"
  }
]
```

Pas d’authentification complexe. Écran initial :

```text
Who is training?

[ User_1 ]    [ Mathias ]
```

**Mode Drill Chronométré.**

Flow :

```text
Dashboard
→ choose micro-task
→ optional difficulty
→ Start
→ strict timer
→ submit / auto-submit
→ immediate result
→ 1 correction screen
→ next item
```

Réglages :

```json
{
  "strict_mode": {
    "timer": true,
    "pause": false,
    "back_navigation": false,
    "auto_submit": true,
    "show_answer_during_attempt": false,
    "show_band_prediction_during_attempt": false
  }
}
```

Reading Module autorise `Back` **à l’intérieur du même module**, mais aucun retour une fois passé au Module 2, conformément aux instructions ETS. Listening ne doit pas autoriser le retour aux questions précédentes. citeturn846024view0turn250754view1

Pour Speaking :

```text
Listen and Repeat:
play once
→ 300–500 ms pause
→ microphone auto-start
→ countdown 8–12 s
→ auto-stop

Interview:
play question
→ microphone auto-start immediately
→ 45 s
→ auto-stop
→ next question
```

ETS spécifie absence de préparation pour ces deux tâches et 45 secondes par question d’Interview. citeturn250754view1turn535094view3

Pour Writing :

```text
Build a Sentence:
shared section timer
drag/click chunks
no spellcheck

Email:
7:00 hard timer

Academic Discussion:
10:00 hard timer
live word count
no grammar correction
```

Les durées Email et Discussion sont officielles. citeturn535094view1turn535094view2

**Simulateur adaptatif.**

Ne pas appeler les branches « easy/hard » dans l’interface candidat afin de ne pas modifier son comportement. Afficher seulement `Module 1` puis `Module 2`.

Engine :

```typescript
type Route = "lower" | "upper";

interface RouterConfig {
  officialThreshold: null;
  trainingThreshold: number;
  model: "percent-correct" | "irt-lite";
}

function routeModule1(
  correct: number,
  total: number,
  cfg: RouterConfig
): Route {
  const p = correct / total;
  return p >= cfg.trainingThreshold ? "upper" : "lower";
}
```

Version améliorée `irt-lite` :

```text
item difficulty b ∈ [-2.5, +2.5]

P(correct | theta, b) =
1 / (1 + exp(-(theta - b)))

estimate theta after router
route upper if theta >= training_cut
```

Le score final de l’app ne doit pas transformer naïvement `correct/35` en Band. ETS utilise de l’IRT/equating pour Reading et Listening. citeturn438864view4

Le produit doit donc afficher :

```text
Training accuracy: 82%
Internal projected band: 5.0
Confidence: medium

NOT:
"Official TOEFL score: 5.0"
```

**Tracker C1.**

Dashboard minimal :

```text
-------------------------------------------------
TOEFL TARGET           5.0
Projected overall      4.63
Gap                    +0.12 raw mean to threshold
Exam date              2026-12-28
Days remaining         54
-------------------------------------------------
Reading       5.0   stable
Listening     4.5   ↑
Writing       4.5   ↑
Speaking      4.5   critical
-------------------------------------------------
Critical path:
Speaking 4.5 → 5.0
Expected effort: 9 focused sessions
Highest ROI task: Listen & Repeat
-------------------------------------------------
```

Calcul de chemin critique :

```text
for each section:
    estimate P(section_band + 0.5 | h hours training)

marginal_value(section) =
    delta_P(overall >= 5.0) / expected_hours
```

Le tracker ne doit pas se contenter de moyennes historiques. Utiliser EWMA :

```text
performance_t =
alpha * newest_result
+ (1-alpha) * previous_estimate

recommended alpha = 0.25–0.35
```

Projection par micro-tâche :

```json
{
  "reading": {
    "complete_words": {
      "accuracy": 0.86,
      "speed_sec_per_item": 11.2,
      "trend": 0.04
    },
    "daily_life": {
      "accuracy": 0.91,
      "trend": 0.01
    },
    "academic_passage": {
      "accuracy": 0.72,
      "trend": 0.05
    }
  }
}
```

**Error-driven drilling.** Chaque erreur doit créer un poids de réapparition :

```text
priority(item_pattern) =
0.40 * error_frequency
+ 0.25 * recency
+ 0.20 * band_impact
+ 0.15 * speed_deficit
```

Exemple :

```text
Mathias:
embedded question errors = 5/12
relative clause errors = 1/10

→ next Build Sentence set:
50% embedded questions
20% previous failed variants
30% mixed retention
```

**Listen & Repeat memory ladder.**

```text
Level 1: 5–8 syllables
criterion: 90% exact

Level 2: 8–12
criterion: 90%

Level 3: 12–16
criterion: 85%

Level 4: 16–20
criterion: 80%

Level 5: 20–24
criterion: rubric proxy >=4

Level 6: 24–29
criterion: rubric proxy >=4
```

Le principe de progression en longueur est conforme au design de la tâche ; les bandes syllabiques sont une implémentation pédagogique interne. citeturn951496search5turn237556search2

**Academic Discussion training loop.**

```text
0:00–0:30  read professor
0:30–1:00  scan students
1:00–1:30  choose position + 2 reasons
1:30–8:30  write
8:30–9:30  grammar correction
9:30–10:00 lexical/mechanics scan
```

**Email loop.**

```text
0:00–0:30 requirements extraction
0:30–0:50 register + opening
0:50–5:40 write
5:40–6:30 requirement checklist
6:30–7:00 grammar/mechanics
```

**Interview loop mental.**

```text
ANSWER → WHY → EXAMPLE → IMPLICATION
```

Pour Q1–Q2, privilégier expérience concrète ; pour Q3–Q4, thèse + mécanisme + qualification. Cette progression correspond à la structure publiée de la tâche, où les questions initiales portent sur expérience/faits et les dernières sur des enjeux plus généraux. citeturn535094view3

**Critère de sortie du sprint.**

Le produit doit afficher `READY` uniquement si les conditions suivantes sont simultanément satisfaites :

```json
{
  "ready_gate": {
    "last_3_full_simulations": {
      "minimum_projected_overall": 5.0
    },
    "minimum_projected_section": 4.0,
    "router_training_accuracy": {
      "reading": 0.8,
      "listening": 0.8
    },
    "writing": {
      "email_median_rubric": 4.0,
      "discussion_median_rubric": 4.0
    },
    "speaking": {
      "repeat_median_rubric": 4.0,
      "interview_median_rubric": 4.0
    },
    "timing_violations_last_7_days": 0
  }
}
```

Le seuil de préparation doit viser **5.0 avec marge**, pas exactement 4.75 à chaque simulation. Comme l’overall est arrondi et que les performances réelles comportent de la variance, la cible interne recommandée est une moyenne projetée d’au moins **4.875–5.0**, avec aucun domaine structurellement faible. La règle officielle demeure toutefois uniquement l’arrondi de la moyenne des quatre bandes au demi-point le plus proche. citeturn222828view0