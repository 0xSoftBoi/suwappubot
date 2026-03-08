import { Window } from 'happy-dom'

const window = new Window()

// @ts-ignore
globalThis.window = window
// @ts-ignore
globalThis.document = window.document
// @ts-ignore
globalThis.navigator = window.navigator
