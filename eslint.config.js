import jsLint from "@eslint/js"
import tsLint from "typescript-eslint"

export default [
    {
        files: ["**/*.{js,mjs,cjs,ts,mts,jsx,tsx}"],
        languageOptions: {
            parser: "@typescript-eslint/parser",
            parserOptions: {
                sourceType: "module"
            }
        }
    },
    jsLint.configs.recommended,
    ...tsLint.configs.recommended,
]
