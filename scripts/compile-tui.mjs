import { transformFileAsync } from "@babel/core"
import { writeFile, unlink } from "node:fs/promises"
import resolver from "babel-plugin-module-resolver"
import solid from "babel-preset-solid"

const source = new URL("../dist/tui.jsx", import.meta.url)
const output = new URL("../dist/tui.js", import.meta.url)
const result = await transformFileAsync(source.pathname, {
  configFile: false,
  babelrc: false,
  presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }]],
  plugins: [[resolver, {
    resolvePath(specifier) {
      // Node's default solid-js export is the non-reactive server build.
      return specifier === "solid-js" ? "solid-js/dist/solid.js" : specifier
    },
  }]],
})
if (!result?.code) throw new Error("Failed to compile TUI Solid components")
await writeFile(output, result.code)
await unlink(source)
