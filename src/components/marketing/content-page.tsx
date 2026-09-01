import { Check } from "lucide-react";
import type { PublicPage } from "@/content/public-pages";
import { ButtonLink } from "@/components/ui/button-link";

export function ContentPage({ page }: { page: PublicPage }) {
  return (
    <main id="main-content">
      <section className="inner-hero">
        <div className="page-frame inner-hero__grid">
          <div><p className="eyebrow">{page.eyebrow}</p><h1>{page.title}</h1></div>
          <div className="inner-hero__intro">
            {page.intro.map((text) => <p key={text}>{text}</p>)}
            {page.ctaLabel && page.ctaHref ? <ButtonLink href={page.ctaHref}>{page.ctaLabel}</ButtonLink> : null}
          </div>
        </div>
      </section>
      <section className="content-shell">
        <div className="page-frame content-grid">
          {page.sections.map((section, index) => (
            <article className="content-card" key={section.title}>
              <span className="content-card__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{section.title}</h2>
                {section.body?.map((text) => <p key={text}>{text}</p>)}
                {section.bullets ? <ul>{section.bullets.map((item) => <li key={item}><Check aria-hidden="true" /><span>{item}</span></li>)}</ul> : null}
                {section.note ? <p className="content-card__note">{section.note}</p> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
      {page.ctaLabel && page.ctaHref ? (
        <section className="inner-cta">
          <div className="page-frame inner-cta__box">
            <div><p className="eyebrow eyebrow--light">READY WHEN YOU ARE</p><h2>Take the next useful step.</h2></div>
            <ButtonLink href={page.ctaHref} variant="light">{page.ctaLabel}</ButtonLink>
          </div>
        </section>
      ) : null}
    </main>
  );
}
