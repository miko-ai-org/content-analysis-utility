# Content analysis utility

This utility ingests a zip file and estimates how much time it will take for a human to go through all the content in it.

## Installation

```bash
npm install
```

Set the following env vars:
```
GOOGLE_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The google api key should have youtube API access.

Create a desktop app OAuth client with Gdrive access, and download the credentials.json file, and put it in the root of the project.


## Usage

```bash
npm start
```

