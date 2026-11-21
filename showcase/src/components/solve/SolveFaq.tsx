'use client';

import {
  Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger,
} from '@ui-sdk/react/accordion';

/**
 * Visible Q/A. Every panel is kept mounted (hidden, findable) so the answers
 * are in the server HTML for crawlers and answer engines without client JS.
 * The first one starts open.
 */
export default function SolveFaq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <Accordion multiple hiddenUntilFound defaultValue={['q0']} className="sv-faq">
      {items.map((f, i) => (
        <AccordionItem key={f.q} value={`q${i}`} className="sv-faq__item">
          <AccordionHeader className="sv-faq__h">
            <AccordionTrigger className="sv-faq__trigger">
              <span>{f.q}</span>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </AccordionTrigger>
          </AccordionHeader>
          <AccordionPanel keepMounted className="sv-faq__panel"><p>{f.a}</p></AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
