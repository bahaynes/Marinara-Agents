// 5etools tag stripper and action mechanics parser.
// Converts 5etools markup (e.g. `{@damage 2d6}`, `{@hit 5}`, `{@dc 14}`) into
// plain readable text, and extracts structured Marinara ActionMechanics.

/**
 * Strip 5etools inline tags and formatting into clean Markdown or plain text.
 * Handles tags such as {@spell name}, {@item name}, {@damage 1d6+2}, {@dice 1d20},
 * {@dc 15}, {@condition prone}, {@creature goblin}, etc.
 */
export function strip5eTags(text) {
  if (!text || typeof text !== "string") return "";

  return (
    text
      // A reference tag reads name|source|display: {@spell fireball|phb|Fireball Spell} -> Fireball Spell,
      // {@sense Darkvision|XPHB} -> Darkvision. Only a third part is display text; the second is the source.
      .replace(
        /\{@(?:spell|item|creature|race|background|feat|condition|disease|sense|action|skill|language|table)\s+([^}]+)\}/gi,
        (_, body) => referenceText(body),
      )
      // Damage, dice, hit, dc tags
      .replace(/\{@damage\s+([^}]+)\}/gi, "$1")
      .replace(/\{@scaledamage\s+[^|]+\|[^|]+\|([^}]+)\}/gi, "$1")
      .replace(/\{@dice\s+([^}]+)\}/gi, "$1")
      .replace(/\{@hit\s+([^}]+)\}/gi, "+$1")
      .replace(/\{@d20\s+([^}]+)\}/gi, "+$1")
      .replace(/\{@dc\s+([^}]+)\}/gi, "DC $1")
      .replace(/\{@chance\s+([^|}]+)[^}]*\}/gi, "$1%")
      .replace(/\{@recharge(?:\s+(\d+))?\}/gi, (_, r) => (r ? `(Recharge ${r}–6)` : "(Recharge 6)"))
      // Formatting tags
      .replace(/\{@b\s+([^}]+)\}/gi, "**$1**")
      .replace(/\{@i\s+([^}]+)\}/gi, "*$1*")
      .replace(/\{@u\s+([^}]+)\}/gi, "$1")
      .replace(/\{@s\s+([^}]+)\}/gi, "~~$1~~")
      .replace(/\{@kbd\s+([^}]+)\}/gi, "`$1`")
      .replace(/\{@code\s+([^}]+)\}/gi, "`$1`")
      .replace(/\{@note\s+([^}]+)\}/gi, "Note: $1")
      // Feature links carry more parts before their display text: name|class|classSource|level|source|display,
      // and a subclass feature's name|class|classSource|subclass|subclassSource|level|source|display.
      .replace(/\{@classFeature\s+([^}]+)\}/gi, (_, body) => featureText(body, 5))
      .replace(/\{@subclassFeature\s+([^}]+)\}/gi, (_, body) => featureText(body, 7))
      // A filter link shows its first part; its later parts are the filter's arguments.
      .replace(/\{@filter\s+([^}|]+)[^}]*\}/gi, "$1")
      // Remaining tags ({@variantrule Bonus Action|XPHB}, {@class Fighter|XPHB}) read like references.
      .replace(/\{@[a-z0-9]+\s+([^}]+)\}/gi, (_, body) => referenceText(body))
      .trim()
  );
}

/** The text a name|source|display reference shows: its display part when it has one, else its name. */
function referenceText(body) {
  const parts = body.split("|");
  return (parts[2] || parts[0]).trim();
}

/** A feature link's display part (at `displayAt`) when it has one, else its name. */
function featureText(body, displayAt) {
  const parts = body.split("|");
  return (parts[displayAt] || parts[0]).trim();
}

/**
 * Recursively convert a 5etools entry or array of entries (strings, lists, tables)
 * into a single Markdown string.
 */
export function render5eEntries(entries) {
  if (!entries) return "";
  if (typeof entries === "string") return strip5eTags(entries);
  if (!Array.isArray(entries)) {
    if (entries.type === "entries" && entries.entries) {
      const header = entries.name ? `**${entries.name}.** ` : "";
      return header + render5eEntries(entries.entries);
    }
    if (entries.type === "list" && Array.isArray(entries.items)) {
      return entries.items.map((item) => `- ${render5eEntries(item)}`).join("\n");
    }
    if (entries.type === "table" && Array.isArray(entries.rows)) {
      const colLabels = (entries.colLabels || []).map(strip5eTags);
      const rows = entries.rows.map((r) =>
        r.map((cell) => strip5eTags(typeof cell === "object" ? render5eEntries(cell) : String(cell))),
      );
      let out = "";
      if (colLabels.length > 0) {
        out += `| ${colLabels.join(" | ")} |\n`;
        out += `| ${colLabels.map(() => "---").join(" | ")} |\n`;
      }
      for (const row of rows) {
        out += `| ${row.join(" | ")} |\n`;
      }
      return out;
    }
    if (entries.entry) return render5eEntries(entries.entry);
    return "";
  }

  return entries
    .map((e) => {
      if (typeof e === "string") return strip5eTags(e);
      if (e.type === "entries" && e.entries) {
        const header = e.name ? `**${e.name}.** ` : "";
        return header + render5eEntries(e.entries);
      }
      if (e.type === "list") return render5eEntries(e);
      if (e.type === "table") return render5eEntries(e);
      if (e.type === "item") {
        const header = e.name ? `**${e.name}.** ` : "";
        return header + render5eEntries(e.entry || e.entries);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Extract structured ActionMechanics from a 5etools action, spell, or feature entry.
 */
export function extract5eMechanics(item) {
  const text = JSON.stringify(item);
  const mechanics = {};

  // Parse Attack Bonus
  const hitMatch = text.match(/\{@hit\s+(\d+)\}/i);
  if (hitMatch) {
    mechanics.toHit = { flat: parseInt(hitMatch[1], 10) };
  }

  // Parse Damage
  const dmgMatch = text.match(/\{@damage\s+([^}]+)\}/i);
  if (dmgMatch) {
    const diceStr = dmgMatch[1].replace(/\s+/g, "");
    mechanics.damage = { dice: diceStr };
  }

  // Parse Save DC & Ability
  const dcMatch = text.match(/\{@dc\s+(\d+)\}/i);
  const saveAbilityMatch =
    text.match(/\{@actSave\s+([a-z]{3})\}/i) ||
    text.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw\b/i);
  if (dcMatch || saveAbilityMatch) {
    const ability = saveAbilityMatch
      ? saveAbilityMatch[1].length === 3
        ? mapShortAbility(saveAbilityMatch[1].toLowerCase())
        : saveAbilityMatch[1].toLowerCase()
      : undefined;
    mechanics.save = {
      ...(dcMatch ? { difficulty: parseInt(dcMatch[1], 10) } : {}),
      ...(ability ? { ability } : {}),
    };
  }

  // Parse Recharge
  const rechargeMatch = text.match(/\{@recharge(?:\s+(\d+))?\}/i);
  if (rechargeMatch) {
    mechanics.recharge = { atLeast: parseInt(rechargeMatch[1] || "6", 10) };
  }

  return Object.keys(mechanics).length > 0 ? mechanics : undefined;
}

function mapShortAbility(short) {
  const map = {
    str: "strength",
    dex: "dexterity",
    con: "constitution",
    int: "intelligence",
    wis: "wisdom",
    cha: "charisma",
  };
  return map[short] || short;
}
