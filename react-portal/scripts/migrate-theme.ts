#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// migrate-theme — thin CLI wrapper around the pure `migrateClassName` codemod.
//
// Best-effort: rewrites the contents of `className="..."` and
// `className={`...`}` (no-interpolation) literals in a file. The pure function
// in src/theming/codemod.ts is the important, tested deliverable; this wrapper
// just locates className literals and feeds each through it.
//
// Usage:
//   npx tsx scripts/migrate-theme.ts <file> [--write]
//   (without --write it prints a unified-ish diff of proposed changes)
//
// Intentional limitations (kept simple on purpose):
//   • Only static string literals and template literals WITHOUT `${...}` are
//     migrated. Templates containing interpolation are left untouched (their
//     conditional branches each need human review).
//   • Operates per className literal — exactly the unit the pure function expects.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { migrateClassName } from '../src/theming/codemod.ts';

function migrateSource(src: string): { out: string; changes: Array<[string, string]> } {
    const changes: Array<[string, string]> = [];

    // className="..."  and  className='...'
    const doubleOrSingle = /className=(["'])([^"'`]*?)\1/g;
    // className={`...`}  (only when there is no ${ interpolation inside)
    const templ = /className=\{`([^`]*?)`\}/g;

    let out = src.replace(doubleOrSingle, (full, quote, body) => {
        const migrated = migrateClassName(body);
        if (migrated !== body) changes.push([body, migrated]);
        return `className=${quote}${migrated}${quote}`;
    });

    out = out.replace(templ, (full, body) => {
        if (body.includes('${')) return full; // skip interpolated templates
        const migrated = migrateClassName(body);
        if (migrated !== body) changes.push([body, migrated]);
        return `className={\`${migrated}\`}`;
    });

    return { out, changes };
}

function main() {
    const args = process.argv.slice(2);
    const write = args.includes('--write');
    const file = args.find((a) => !a.startsWith('--'));
    if (!file) {
        console.error('usage: migrate-theme.ts <file> [--write]');
        process.exit(1);
    }

    const src = readFileSync(file, 'utf8');
    const { out, changes } = migrateSource(src);

    if (changes.length === 0) {
        console.log(`No changes for ${file}.`);
        return;
    }

    console.log(`${changes.length} className literal(s) migrated in ${file}:`);
    for (const [before, after] of changes) {
        console.log(`  - ${before}`);
        console.log(`  + ${after}`);
    }

    if (write) {
        writeFileSync(file, out, 'utf8');
        console.log(`\nWrote ${file}.`);
    } else {
        console.log('\n(dry run — pass --write to apply)');
    }
}

main();

// exported for unit reuse / testing of the file-rewrite layer
export { migrateSource };
