import type { BusinessProfile, Fact, KnowledgeSource } from "../types";

// A made-up business that is not a shop, used by the tests from the first
// day (decision D88): if the AI module quietly assumed it was selling things,
// these tests would fail.

export const clinicProfile: BusinessProfile = {
  name: "Harbor Dental Clinic",
  description: "A small dental clinic offering check-ups, cleaning and fillings by appointment.",
  tone: "Calm, kind and brief.",
  languages: ["en", "ar"],
  mayPromise: ["A call back within one working day"],
  neverPromise: ["A diagnosis", "Appointment times not in the facts"],
  handoverTopics: ["Pain or emergencies", "Billing disputes"],
  contact: "Call the front desk.",
};

const FACTS: Fact[] = [
  {
    id: "service:cleaning",
    kind: "service",
    text: "A cleaning takes 45 minutes and costs 60 dollars.",
  },
  {
    id: "service:checkup",
    kind: "service",
    text: "A check-up takes 30 minutes and costs 40 dollars.",
  },
  { id: "hours:weekdays", kind: "hours", text: "Open Monday to Friday, 9:00 to 17:00." },
  {
    id: "policy:cancel",
    kind: "policy",
    text: "Appointments can be cancelled free of charge up to 24 hours before.",
  },
];

/** Matches facts sharing a word with the question; never makes one up. */
export const clinicKnowledge: KnowledgeSource = {
  abilities: () => [
    {
      id: "services",
      description: "The clinic's treatments, how long they take and what they cost",
    },
    { id: "hours", description: "Opening hours" },
    { id: "policies", description: "Booking and cancellation rules" },
  ],
  async search(question, { limit }) {
    const words = new Set(question.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
    return FACTS.filter((fact) =>
      (fact.text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).some((word) => words.has(word)),
    ).slice(0, limit);
  },
};
