# Countryle Unlimited

A free-play clone of the country-guessing game Countryle. Guess the hidden country; every guess is graded on five attributes (continent, hemisphere, population, average temperature, coordinates). No daily limit: press **Play again** or **New game** at any time. No social media sharing.

## Play / publish

It is a static site (no build step). To publish with GitHub Pages: repository **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

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
