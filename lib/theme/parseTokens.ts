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
