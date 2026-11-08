// One journey can have several travel tickets and separate seat reservations.
// Reservations cover existing passengers and must not increase the total.
export function groupTicketsByJourney(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    const date = ticket.filename.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    // A single return PDF may cover both the outward and homeward journey.
    const links = ticket.journeys || [{
      id: `${ticket.direction}:${date || ticket.filename}`,
      direction: ticket.direction,
      date,
      mode: ticket.direction === "roundtrip" || ticket.filename.includes("flixbus") ? "bus" : "train",
    }];
    for (const link of links) {
      if (!groups.has(link.id)) {
        groups.set(link.id, { ...link, tickets: [], passengers: 0 });
      }
      const journey = groups.get(link.id);
      if (journey.tickets.some((item) => item.filename === ticket.filename)) continue;
      journey.tickets.push(ticket);
      if (ticket.kind === "ticket") journey.passengers += ticket.passengers;
    }
  }
  return [...groups.values()].map((journey) => ({
    ...journey,
    tickets: journey.mode === "bus"
      ? [...journey.tickets].sort((a, b) => b.passengers - a.passengers)
      : journey.tickets,
  }));
}
