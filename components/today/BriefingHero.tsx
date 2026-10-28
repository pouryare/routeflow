import Avatar from "@/components/meridian/Avatar";
import CountUp from "@/components/meridian/CountUp";
import WordReveal from "@/components/meridian/WordReveal";
import type { Briefing as BriefingData } from "@/lib/repo/briefing";
import type { BriefingCard } from "@/lib/repo/briefingCards";
import { faJalaliLong } from "@/lib/jalali";

/** Who this is, and how much is waiting on them.
 *
 *  The shape is a Windows Hello screen on purpose: a large photograph, the person's name,
 *  their role and today's date, and then ONE number. A Hello screen answers exactly one
 *  question — who is this, and what do they need — and answers nothing else. The previous
 *  briefing was five equal-weight panels, so nothing read as more important than anything
 *  else and the reader had to do the ranking themselves.
 *
 *  Three rules this component exists to hold:
 *
 *  1. **One headline number.** Not four. `CountUp` sweeps it on arrival, which is exactly
 *     what MASTER.md's Tier 3 motion is for, and the only place on this screen where a
 *     number animates — a card grid of moving figures is noise.
 *  2. **The photo is `aria-hidden`.** The name beside it is the accessible content. A screen
 *     reader announcing a face adds nothing the reader did not just read.
 *  3. **Zero means zero.** A quiet day says "nothing needs you" rather than hiding the
 *     number, so a blank screen is never ambiguous between "quiet" and "signed in wrong".
 *
 *  The photo is bound to `hero.userId` and NOT to the active role, so it never swaps when a
 *  dual-hat rep changes role. See the decision at the top of the plan.
 */
export default function BriefingHero({
  data,
  card,
  roleLabel,
  dateIso,
}: {
  data: BriefingData;
  card: BriefingCard | null;
  roleLabel: string;
  dateIso: string;
}) {
  const count = card?.count ?? 0;
  return (
    <header className="hello">
      <span className="hello__photo" aria-hidden="true">
        <Avatar
          userId={data.hero.userId}
          name={data.hero.displayName}
          src={data.hero.avatarUrl}
          size={96}
        />
      </span>
      <h1 className="hello__name"><WordReveal text={data.hero.displayName} /></h1>
      <p className="hello__meta">
        {roleLabel} · {faJalaliLong(dateIso)}
      </p>

      {count === 0 ? (
        <p className="hello__quiet">امروز چیزی منتظر شما نیست.</p>
      ) : (
        <div className="hello__figure">
          {/* Announced as a sentence, not as a bare digit: a screen reader that reads
              "5" tells a person nothing, and this is the one number the screen exists for. */}
          <span className="hello__count" role="img" aria-label={`${count} مورد نیاز به اقدام`}>
            <CountUp value={count} />
          </span>
          <span className="hello__caption">نیاز به اقدام</span>
        </div>
      )}
    </header>
  );
}