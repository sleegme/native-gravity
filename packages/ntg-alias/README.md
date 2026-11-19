# @sleeg/ntg

Short alias for [native-gravity](https://www.npmjs.com/package/native-gravity).

```sh
# npm (<= 11)
npm i -g @sleeg/ntg

# npm 12+ (allows postinstall to register the agy plugin)
npm i -g --allow-scripts=native-gravity,@sleeg/ntg @sleeg/ntg
# optional: persist for future updates
npm config set allow-scripts=native-gravity,@sleeg/ntg --location=user

# Bun (allows postinstall to register the agy plugin)
bun add -g --trust @sleeg/ntg

ntg                     # same as: native-gravity
```

If install scripts were skipped (`npm i -g` on npm 12+ without `--allow-scripts`, or `bun add -g` without `--trust`), run `ntg` once to register the `agy` plugin automatically and record trust in Bun's global `package.json`.
