# WordGame - TDDD27 Project

## Deliverables

### Github repo:

The GitLab repo was mirrored and we worked inside a GitHub [repo](https://github.com/Skill-issue-coding/WordGame---TDDD27-Project/tree/main). It has a better commit history and co-contributed commits are visible.

### Project Screencast:

Youtube video of screencast [here](https://youtu.be/nDoNodo492k).

### Individual oral code screen-cast:

Marcus Skoglund - marsk090: [here](https://youtu.be/oU8fcmhylus) <br />
_Others coming soon..._

## Preprocessing

The preprocessing pipeline lives in [preprocessing/README.md](preprocessing/README.md). It builds Swedish word and entity embeddings using **Wikipedia2Vec** (trained on Swedish Wikipedia, 300-dimensional), and outputs files into `server/wordfiles/`. Follow the setup and stage order in that document.

## Data Sources

- **Swedish stopwords:** From [peterdalle/svensktext](https://github.com/peterdalle/svensktext) (see `preprocessing/stopwords/`).

- **Common Swedish words and frequency:** From Sprakbanken Korp data in `preprocessing/korp/`.

- **Kelly word list:** `preprocessing/kelly.xml` from Sprakbanken.

## Stack

- Preprocessing: Python pipeline (see [preprocessing/README.md](preprocessing/README.md))
- Backend: Go (loads `server/wordfiles/` at startup)
- Frontend: Next.js
