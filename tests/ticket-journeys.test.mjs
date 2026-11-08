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

test("one roundtrip supplement contributes two people to each bus journey, while trains stay separate", () => {
  const outbound = { id: "bus-outbound-2026-11-15", direction: "outbound", date: "2026-11-15", mode: "bus" };
  const home = { id: "bus-return-2026-11-26", direction: "return", date: "2026-11-26", mode: "bus" };
  const supplement = { ...ticket("2026-11-15", "supplement", 2, "ticket", "roundtrip"), journeys: [outbound, home] };
  const files = [ticket("2026-11-14", "train-outbound", 20),
    ticket("2026-11-27", "train-home", 17, "ticket", "return"), supplement,
    { ...ticket("2026-11-15", "main-bus-outbound", 18), journeys: [outbound] },
    { ...ticket("2026-11-26", "main-bus-home", 15, "ticket", "return"), journeys: [home] }];
  const journeys = groupTicketsByJourney(files);
  assert.equal(journeys.length, 4);
  const buses = journeys.filter(({ mode }) => mode === "bus");
  assert.deepEqual(buses.map(({ passengers }) => passengers), [20, 17]);
  assert.deepEqual(buses.map(({ tickets }) => tickets.length), [2, 2]);
  for (const bus of buses) {
    assert.equal(bus.tickets.filter(({ filename }) => filename === supplement.filename).length, 1);
    assert.ok(bus.tickets[0].passengers > 2, "main booking should appear before the supplement");
  }
  assert.deepEqual(journeys.filter(({ mode }) => mode === "train").map(({ passengers }) => passengers), [20, 17]);
});

test("a repeated journey reference cannot double count a passenger or a PDF", () => {
  const journey = { id: "same-bus", direction: "outbound", date: "2026-11-15", mode: "bus" };
  const [group] = groupTicketsByJourney([{ ...ticket("2026-11-15", "extra", 2), journeys: [journey, journey] }]);
  assert.equal(group.passengers, 2);
  assert.equal(group.tickets.length, 1);
});
