# Emoji catalog

`catalog.json` contains the fully-qualified entries from Unicode Emoji 16.0's
[emoji-test.txt](https://unicode.org/Public/emoji/16.0/emoji-test.txt), including
skin tones and flags. Names and group keywords come from that file. See
[LICENSE.txt](LICENSE.txt) for the Unicode data license.

To regenerate, download that file and run:

```sh
node tools/import-status-emojis.mjs /path/to/emoji-test.txt
npm run format
```

`../status-emojis.ts` puts common work statuses first and adds search synonyms,
then appends the remaining Unicode catalog without duplicates.
