/* A deliberately small CSS reader used only by contrast.test.ts, so the
   contrast assertions run against the real app/tokens.css instead of a
   second copy of the hex values that could drift out of sync.

   Not a general CSS parser. It assumes tokens.css's actual shape: flat,
   non-nested selector blocks containing custom properties. */

export type TokenBlocks = Record<string, Record<string, string>>;

export function parseTokenBlocks(css: string): TokenBlocks {
  // Strip comments first: tokens.css discusses token names in prose, and those
  // mentions must not be read as declarations.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  /* This parser cannot represent nesting, and its failure mode without a guard
     is silent: an @media block's inner selector overwrites the outer one, so
     blocks[":root"] comes back present but wrong, and the contrast test passes
     while asserting nothing. A colour-token file is exactly where an
     @media (prefers-color-scheme) block tends to appear, so fail loudly instead. */
  let depth = 0;
  for (const ch of withoutComments) {
    if (ch === "{") {
      depth++;
      if (depth > 1) {
        throw new Error(
          "parseTokenBlocks: found a nested block (e.g. @media or @supports wrapping a " +
            "selector). This parser only understands flat, non-nested selector blocks and " +
            "would otherwise silently overwrite the outer selector's tokens with the inner " +
            "block's, so it refuses to guess instead.",
        );
      }
    } else if (ch === "}") {
      depth--;
    }
  }
  if (depth !== 0) {
    throw new Error(
      "parseTokenBlocks: unbalanced braces in the input CSS (depth ended at " +
        depth +
        ", expected 0). Refusing to parse, since the block matcher below would silently " +
        "produce partial or misaligned results rather than fail.",
    );
  }

  const blocks: TokenBlocks = {};
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;

  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(withoutComments)) !== null) {
    const selector = block[1].trim();
    const body = block[2];
    const tokens: Record<string, string> = {};

    const declPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let decl: RegExpExecArray | null;
    while ((decl = declPattern.exec(body)) !== null) {
      tokens[decl[1]] = decl[2].trim();
    }

    if (Object.keys(tokens).length > 0) blocks[selector] = tokens;
  }

  return blocks;
}
