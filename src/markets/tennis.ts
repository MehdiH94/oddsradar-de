// The tennis matches whose every market is read (src/scraper/marketsRun.ts)
// and priced against the exchange: the main tours', where the bookmakers
// offer the most markets and the exchange has money. By the competition's
// name, as the bookmakers give it ("Pékin WTA", "Tokyo ATP", 4/10/2026).
const MAIN_TOURS = /\b(ATP|WTA)\b|grand chelem|roland[- ]garros|wimbledon|us open|open d'australie|australian open|coupe davis|billie jean king|united cup|laver cup/i;
const MINOR = /challenger|\bITF\b|\bUTR\b|doubles?|qualif/i;

export function isMainTour(competition: string): boolean {
  return MAIN_TOURS.test(competition) && !MINOR.test(competition);
}
