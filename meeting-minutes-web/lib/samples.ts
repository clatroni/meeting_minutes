export const SAMPLE_TRANSCRIPTS: Record<string, { label: string; text: string }> = {
  enerwave: {
    label: "Enerwave — ETL Pipeline Status Sync (EN)",
    text: `Christina Latroni: Good morning everyone. Today's sync covers the ETL pipeline status across source ingestion, transformation layer, data quality, and the go-live timeline.
Eleni Antoniou: Sounds good. Where are we on source ingestion?
Yannis Papadakis: We've completed connectivity to four of six planned source systems. The legacy operational DB is blocked on a service account from infra, and the third-party billing API is blocked on a contract amendment.
Nikos Papadopoulos: I'll raise the service account request today and target Friday 15 May for provisioning. The billing API contract should be back by Wednesday 20 May.
Christina Latroni: If the billing API slips past 20 May, we need a fallback. Eleni, can we go with a manual CSV drop for up to two weeks post go-live?
Eleni Antoniou: Yes, that works. Let's confirm it as the contingency.
Yannis Papadakis: On transformation, eighteen of twenty-two business rules are implemented. The four remaining are complex aggregations and need finance team validation.
Eleni Antoniou: I'll set up a working session with the finance controller for Monday 18 May. Yannis, can you prepare a one-pager on the open rules?
Yannis Papadakis: Yes, I'll have it ready by 14 May.
Christina Latroni: Data quality?
Yannis Papadakis: Row-count and null-rate checks are in place at each stage. We had a successful production-like run yesterday with no critical failures. The monitoring dashboard goes out today.
Nikos Papadopoulos: One concern — the overnight incremental load. We need it under ninety minutes.
Yannis Papadakis: Current benchmark is sixty minutes on prod-equivalent volumes. We're within target. The four-hour full load is a risk to monitor if data volumes grow.
Christina Latroni: Go-live remains Thursday 28 May, with business sign-off expected by Friday 22 May. Yannis, prepare and share the cutover checklist by Tuesday 19 May.
Yannis Papadakis: Will do.
Christina Latroni: Thanks everyone.`,
  },
  greek: {
    label: "Σύσκεψη Project (EL)",
    text: `Γιώργος Παπαδόπουλος: Καλημέρα σε όλους. Ξεκινάμε τη συνάντηση.
Μαρία Νικολάου: Καλημέρα. Είμαστε όλοι εδώ;
Γιώργος Παπαδόπουλος: Ναι. Πρώτο θέμα, η παράδοση της αναφοράς. Μαρία, μπορείς να την ετοιμάσεις ως την Παρασκευή;
Μαρία Νικολάου: Ναι, θα την έχω έτοιμη.
Κώστας Δημητρίου: Εγώ ολοκλήρωσα την ανάλυση των δεδομένων χθες και θα στείλω το αρχείο σήμερα.
Γιώργος Παπαδόπουλος: Τέλεια. Κώστα, στείλε μου το αρχείο σήμερα και ενημέρωσε και τη Μαρία.
Κώστας Δημητρίου: Εντάξει, θα τους το στείλω.
Γιώργος Παπαδόπουλος: Υπάρχει κίνδυνος καθυστέρησης στο τμήμα οικονομικών — δεν έχουμε ακόμα υπογραφή για το νέο budget.
Μαρία Νικολάου: Θα το αναλάβω εγώ, θα μιλήσω με τον CFO αυτή την εβδομάδα.
Γιώργος Παπαδόπουλος: Κλείνουμε εδώ. Επόμενη συνάντηση Τετάρτη 27 Μαΐου. Ευχαριστώ όλους.`,
  },
};
