# Empire Quest — Visual System ("The Chronicle Kit")

Derived from the four reference frames. One identity across all surfaces: a war
chronicle bound in leather and gold. Every screen is a page of the same tome.

## The four surfaces (reference → product)
1. Chronicle narrative  ("The Walls Bleed")   — story beat + territorial change + battle outcome panels.
2. Siege recap / after-action ("Blackhaven")  — attacker vs defender ledger, siege-progress stepper.
3. Live tactical siege ("Northwell Gate")     — real-time HUD over the destruction engine. BUILT (siege-hud).
4. Overworld / logistics ("Rivergate")        — province health, convoys, trade, bridges. (bridge destruction lives here.)

## Palette (named hex)
--ink        #0d0b07   page black / canvas base
--leather    #171308   panel body
--leather2   #211a0e   panel top bevel
--gold       #c9a24a   primary trim, engraved headings
--gold-bright#e8d3a0   live values, emphasis
--gold-dim   #7a6535   labels, inactive
--hair       #5c4a24   1px panel borders
--azure      #4f83c2   friendly/wall integrity, house Northwell
--crimson    #a5342a   attacker, danger, breach
--amber      #d0952f   gate integrity, caution
--parch      #d8c8a0   body text on dark
Stone (siege blocks): ochre #b0986c → darkens to #3a342a as damage climbs.

## Type
Display : Cinzel / Trajan — uppercase, letter-spacing .12em, engraved (text-shadow
          #000 + faint gold glow). Titles, panel headers, unit labels, buttons.
Body    : EB Garamond — panel prose, chronicle narrative, quotes (italic).
Data    : Cinzel small for numerals (integrity %, counts) — tabular, gold-bright.
Rule: display carries personality; never set body in the display face.

## Components
Panel        leather gradient, 1px --hair border + inset gold hairline (::before),
             soft outer shadow, 3px radius. Header = engraved caps + gold underline.
Integrity bar 20 discrete segments (not a smooth fill) — reads as counted structure,
             not a loading bar; turns crimson below 30%. Wall=azure, Gate=amber.
Meter (top)  thin 5px continuous bar for soft stats (strength/morale/fatigue).
Heraldic mark house sigil in a shield/roundel; lion=attacker (crimson+gold),
             tree/tower=defender (azure). Top-corner brand + faction badges.
Stepper      siege phases Encamped→Bombardment→Wall Breached→Keep Assault→Capture,
             icon nodes + connecting rule, current node lit gold, done = check.
Event log    timestamped lines, newest on top, severity color (crit/warn/good),
             rise-in animation. Voice: terse field report ("Wall section damaged!").
Command      engraved caps buttons, gold hover glow; primary action in crimson leather.
Roster       unit chips: sigil icon + caps label + current/max count.

## Voice
Field-report terseness in the HUD ("Gate Integrity at 28%"). Chronicle prose is
elevated, past-tense, a scribe recording history ("The banners of the old rule
waver."). Named actors and named engines ("Trebuchet 'Stonegrinder'") — proper
nouns everywhere; they make a systemic war feel remembered.

## Motion
Restraint. The signature motion is the destruction itself — blocks fracturing and
falling, dust, breach. UI motion limited to log rise-in and bar depletion. No
decorative animation competing with the siege.

## Non-negotiables
Blocks are counted, not painted (segmented integrity). Every faction reads by
sigil + color without text. The tome frame is constant; only the page changes.
