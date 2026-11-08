import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTicketsByJourney } from "../ticket-journeys.mjs";

const ticket = (date, id, passengers, kind = "ticket", direction = "outbound") =>
  ({ filename: `${date}-${id}.pdf`, passengers, kind, direction });

test("separate seat reservations do not duplicate passengers on a combined journey", () => {
  const files = [ticket("2026-11-14", "group-1", 8), ticket("2026-11-14", "group-2", 8),
    ticket("2026-11-14", "extra", 1), ticket("2026-11-14", "join-in-aarhus", 3),
    ticket("2026-11-14", "seats-15", 15, "reservation"), ticket("2026-11-14", "seats-1", 1, "reservation")];
  const [journey] = groupTicketsByJourney(files);
  assert.equal(journey.passengers, 20);
  assert.deepEqual(journey.tickets, files);
});

test("outbound, return and roundtrip retain separate totals and every PDF", () => {
  const files = [ticket("2026-11-14", "outbound", 20),
    ticket("2026-11-27", "viborg", 13, "ticket", "return"),
    ticket("2026-11-27", "extra", 1, "ticket", "return"),
    ticket("2026-11-27", "aarhus", 3, "ticket", "return"),
    ticket("2026-11-15", "bus-roundtrip", 2, "ticket", "roundtrip")];
  const journeys = groupTicketsByJourney(files);
  assert.deepEqual(journeys.map(({ passengers }) => passengers), [20, 17, 2]);
  assert.deepEqual(journeys.flatMap(({ tickets }) => tickets), files);
});

test("journeys on different dates are kept apart and reservations alone add no travellers", () => {
  const journeys = groupTicketsByJourney([ticket("2026-11-14", "first", 8),
    ticket("2026-11-21", "second", 5), ticket("2026-11-26", "seats", 3, "reservation")]);
  assert.deepEqual(journeys.map(({ passengers }) => passengers), [8, 5, 0]);
});
