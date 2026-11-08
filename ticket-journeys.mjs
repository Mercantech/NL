// One journey can have several travel tickets and separate seat reservations.
// Reservations cover existing passengers and must not increase the total.
export function groupTicketsByJourney(tickets) {
  const groups = new Map();
  for (const ticket of tickets) {
    const date = ticket.filename.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1];
    const key = `${ticket.direction}:${date || ticket.filename}`;
    if (!groups.has(key)) {
      groups.set(key, { direction: ticket.direction, date, tickets: [], passengers: 0 });
    }
    const journey = groups.get(key);
    journey.tickets.push(ticket);
    if (ticket.kind === "ticket") journey.passengers += ticket.passengers;
  }
  return [...groups.values()];
}
