# Countryle Unlimited

A free-play clone of the country-guessing game Countryle. Guess the hidden country; every guess is graded on five attributes (continent, hemisphere, population, average temperature, coordinates). No daily limit: press **Play again** or **New game** at any time. No social media sharing.

## Play / publish

It is a static site (no build step). To publish with GitHub Pages: repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

## Online features (optional): profile, friends, leaderboard, challenges

With a Firebase project (free Spark plan) players can sign in with Google, keep their statistics on every device, invite friends by email, compare results on a leaderboard and play head-to-head challenges (both players get the same hidden country; fewer guesses wins). Without it, the game runs as before, guest only.

Setup, once, in the [Firebase console](https://console.firebase.google.com):

1. **Create a project** (Google Analytics is not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose a support email, **Save**.
3. **Authentication → Settings → Authorized domains → Add domain**: `dennisrobertgrossman-boop.github.io`.
4. **Build → Firestore Database → Create database**, pick a location (e.g. `eur3 (europe-west)`), start in **production mode**.
5. **Firestore Database → Rules**: replace the contents with [`firestore.rules`](firestore.rules) and **Publish**.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)**, register an app (no hosting needed) and copy the `firebaseConfig` values into [`firebase-config.js`](firebase-config.js).

Invitations are stored in the database and shown to the invited person when they sign in with Google using that email address; the app also offers a pre-written email that the inviter sends from their own mail program (no email is sent by a server).

Limitation: statistics and challenge results are recorded by each player's browser, so a player who edits the page's code could fake them. The database rules stop players from changing each other's data, but not their own. This suits friendly competition; cheat-proof scoring would need server-side code (Firebase Cloud Functions, paid Blaze plan).

## Rules

| Tile | Green | Yellow | Red |
|---|---|---|---|
| Continent | same continent | – | different |
| Hemisphere (central latitude) | same | – | different |
| Population (▲ hidden country has more, ▼ fewer) | within ±10% | half to double | otherwise |
| Average temperature (▲ warmer, ▼ colder) | within 1 °C | within 5 °C | otherwise |
| Coordinates (arrow points toward the hidden country) | correct country | under 1,500 km | otherwise |

Countries: the 193 United Nations member states plus Vatican City (194 in total). Targets are drawn from a shuffled deck, so no country repeats until all 194 have come up. Statistics are kept in the browser's local storage.

## Data sources (MIT licence)

- Names, coordinates, alternative spellings: [`world-countries`](https://github.com/mledoze/countries) 5.1.0
- Continent, population (about 2018), yearly average temperature: [`country-json`](https://github.com/samayo/country-json) 2.3.0. Montenegro's temperature is missing there; an approximate 10.55 °C is used. DR Congo's coordinates are set to its approximate geographic centre (2.88° S, 23.66° E), because the source's rounded value (0°, 25° E) put it in the Northern hemisphere.
- Flags: [`flag-icons`](https://github.com/lipis/flag-icons) 7.6.0
- Background map (`world.svg`): Natural Earth land outlines (public domain) via [`world-atlas`](https://github.com/topojson/world-atlas) 2.0.2 (ISC licence)

Data is in `data/countries.js`.
