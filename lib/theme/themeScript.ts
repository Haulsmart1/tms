import { STORAGE_KEY } from "./theme";

/* Runs synchronously as the first child of <body>, BEFORE any page content is
   parsed or painted, so a user who has chosen light never sees a dark frame
   first.

   It must stay synchronous and inline. Moving this into a React effect, a
   <Script> component with any strategy, or an external file puts it after
   first paint and the flash comes back.

   Only the light case does anything: dark is the value already in :root, so the
   default path needs no JavaScript at all.

   Wrapped in try/catch because localStorage throws in some privacy modes; on
   failure the page simply stays dark, which is the safe outcome here. */
export const THEME_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)})==="light"){document.documentElement.classList.add("light")}}catch(e){}})()`;
