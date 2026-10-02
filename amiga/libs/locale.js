/* locale.js - thin wrapper around AmigaOS locale.library v38+
 *
 * Lets scripts load .catalog files and look up localised strings
 * by numeric ID. The actual library is opened on first use and
 * cached; OpenLocale(NULL) picks the user's system default locale
 * (set via Locale Preferences, falls back to "english" if missing).
 *
 *   var loc = require('locale');
 *   var cat = loc.openCatalog('myapp.catalog', 0);  // version 0 = any
 *   var hello = loc.getString(cat, 1, 'Hello!');     // id=1, default
 *   console.log(hello);
 *   loc.closeCatalog(cat);
 *   loc.close();
 *
 * Catalogs are searched in PROGDIR:catalogs/<language>/,
 * LOCALE:catalogs/<language>/ etc. by the OS - same path resolution
 * a native app would get. If a string ID isn't in the catalog, the
 * default-string argument is returned, so it's safe to call without
 * worrying about a missing translation.
 *
 * NOTE: requires locale.library v38+ (AmigaOS 2.1 / Workbench 38).
 * On older systems openLibrary returns 0; check `loc.available()`.
 */

var amiga = require('amiga');

/* locale.library LVOs (from NDK fd/locale_lib.fd, ##bias 30).
 * LVO = Library Vector Offset; each entry is 6 bytes. Library
 * functions start at -30 after Open/Close/Expunge/Reserved jump
 * vectors. Order in the fd file: OpenLocale, CloseLocale,
 * OpenCatalogA, CloseCatalog, ConvToLower, ConvToUpper, FormatDate,
 * FormatString, GetCatalogStr, GetLocaleStr ...  */
var LVO_OpenLocale     = -30;
var LVO_CloseLocale    = -36;
var LVO_OpenCatalogA   = -42;
var LVO_CloseCatalog   = -48;
var LVO_GetCatalogStr  = -78;

var localeBase = 0;
var defaultLocale = 0;

function ensureOpen() {
    if (localeBase) return localeBase;
    localeBase = amiga.openLibrary('locale.library', 38);
    if (!localeBase) return 0;
    /* OpenLocale(NULL) - user's default locale. If this returns 0
     * (out-of-memory or buggy v38 stub) we close the library and
     * report unavailable. Without this guard we'd later pass NULL
     * as the `locale` argument to OpenCatalogA, which some v38
     * implementations are documented to handle but not all do. */
    defaultLocale = amiga.call(localeBase, LVO_OpenLocale, { a0: 0 });
    if (!defaultLocale) {
        amiga.closeLibrary(localeBase);
        localeBase = 0;
        return 0;
    }
    return localeBase;
}

exports.available = function () {
    return ensureOpen() !== 0;
};

/* Open a catalog by name. Returns an opaque handle (0 on failure).
 * `name` is just the filename ('myapp.catalog'); the OS resolves
 * the actual path via LOCALE:catalogs/<lang>/<name> etc.
 * `version` is currently ignored (would map to OC_Version tag). */
exports.openCatalog = function (name, version) {
    if (!ensureOpen()) return 0;
    var nameBuf = amiga.makeString(name);
    if (!nameBuf) return 0;
    /* tags = NULL - OpenCatalogA accepts a null tag list and uses the
     * default locale's language. amiga.makeTags([]) returns undefined
     * for empty arrays; passing 0 explicitly is cleaner and avoids
     * the undefined-to-register coercion path. `version` is reserved
     * for an OC_Version tag in a future revision; ignored for now. */
    var cat = amiga.call(localeBase, LVO_OpenCatalogA, {
        a0: defaultLocale,
        a1: nameBuf,
        a2: 0
    });
    amiga.freeMem(nameBuf, name.length + 1);
    /* Sanity-check the returned handle. A real Catalog* is a 32-bit
     * even-aligned pointer in normal RAM (well above the reserved
     * exception-vector / ROM-base zone, i.e. >= 0x400). If we get
     * something smaller or odd-aligned, OpenCatalogA likely failed
     * weirdly (or the LVO is wrong and we hit a different function);
     * treat it as NULL so GetCatalogStr never tries to dereference it. */
    if (cat && (cat < 0x400 || (cat & 1))) {
        return 0;
    }
    return cat;
};

exports.closeCatalog = function (cat) {
    if (!cat || !localeBase) return;
    amiga.call(localeBase, LVO_CloseCatalog, { a0: cat });
};

/* Get a localised string. `id` is the numeric ID assigned in the
 * .ct/.cd file; `defaultStr` is what to return when the id isn't
 * in the catalog (or the catalog wasn't loaded). Always returns a
 * string. */
exports.getString = function (cat, id, defaultStr) {
    var fallback = (defaultStr == null) ? '' : ('' + defaultStr);
    /* Short-circuit when the library or catalog isn't usable -
     * saves an FFI round trip and a buffer alloc per call when
     * locale.library is missing or openCatalog returned 0. */
    if (!localeBase || !cat) return fallback;
    var defBuf = amiga.makeString(fallback);
    if (!defBuf) return fallback;
    /* GetCatalogStr(Catalog catalog, LONG stringNum, STRPTR defaultStr).
     * Returns either an internal pointer into the catalog (string
     * found) or `defBuf` itself (not found). peekString copies bytes
     * into a fresh JS string either way, so it's safe to free defBuf
     * after the read. */
    var ptr = amiga.call(localeBase, LVO_GetCatalogStr, {
        a0: cat,
        d0: id,
        a1: defBuf
    });
    var str = ptr ? amiga.peekString(ptr) : fallback;
    amiga.freeMem(defBuf, fallback.length + 1);
    return str;
};

/* Close the default locale and the library. Optional - done at
 * process exit anyway, but useful for clean shutdown in long-
 * running programs. */
exports.close = function () {
    if (defaultLocale && localeBase) {
        amiga.call(localeBase, LVO_CloseLocale, { a0: defaultLocale });
        defaultLocale = 0;
    }
    if (localeBase) {
        amiga.closeLibrary(localeBase);
        localeBase = 0;
    }
};
