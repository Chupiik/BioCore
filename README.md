# BioCore

An interactive web app for learning biology with real data, built with a coding agent for the course
C3790 AI-Assisted Bioinformatics Data Analysis.

BioCore is made of modules. We start with two:

- **Amino acids:** names, one- and three-letter codes, structures, hydrophobicity and charge, with flashcards, quizzes
  and visualisations, applied to real human proteins.
- **Genetic code and translation:** codons, reading frames and translating real human mRNA into protein.

## 1. Problem

Students learn amino acids and the genetic code from static tables and memorise them without seeing why they matter.
Flashcard apps stop at memorising, and professional tools (ExPASy, UniProt) calculate results but don't explain them.
BioCore connects the two: it lets you learn the basics with flashcards and quizzes, see them in interactive charts,
and then use them on real human proteins and genes.

**Amino acids module**
- Flashcards and quizzes: name ↔ one-letter ↔ three-letter code, structure → name, "Which is more hydrophobic?", "Charged at pH 7?"
- Visualisations: structure drawings, property diagram (hydrophobic, polar, charged, aromatic), hydrophobicity chart
- Real protein: enter a protein from UniProt and see its amino acid composition, charge and hydropathy plot

**Genetic code and translation module**
- Codon wheel: click a codon to see its amino acid, and the other way round
- Codon quiz: "Which amino acid does GCU code for?", "How many codons does leucine have?"
- Translate it: take a piece of real human mRNA, find the start codon and reading frame, translate it, find the stop codon

**Gamification and progress (both modules)**
- No account needed: progress is saved in your browser, so it is still there next time you open the app on the same device.
- Points for correct answers, streaks, levels and badges for finishing a topic.
- The app remembers which questions you get wrong and asks them again more often until you know them, while things you
  already know come back less often.
- A progress page shows your score, what you have mastered and what you still need to practise.

## 2. Data

All data is public reference data with no personal or patient information, so it is safe to send to an AI model.
Everything is free and needs no API key.

### Amino acids module

| Source | What we take from it | Link / access |
|---|---|---|
| **PubChem** (NCBI) | name, formula, molecular weight, SMILES (for drawing the structure) of each of the 20 amino acids | Website: https://pubchem.ncbi.nlm.nih.gov/ · API docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest · Example: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/leucine/property/MolecularFormula,MolecularWeight,IsomericSMILES/JSON` |
| **Kyte–Doolittle hydropathy scale** | hydrophobicity value of each amino acid (Ile +4.5 … Arg −4.5) | Original paper: Kyte J & Doolittle RF (1982), J Mol Biol 157:105–132, https://doi.org/10.1016/0022-2836(82)90515-0 · Table on ExPASy: https://web.expasy.org/protscale/pscale/Hphob.Doolittle.html |
| **Side-chain pKa values** | charge of each amino acid at a given pH, isoelectric point | The ExPASy Compute pI/Mw tool uses the pK set of Bjellqvist et al. (named on its documentation page): https://web.expasy.org/compute_pi/ · https://web.expasy.org/compute_pi/pi_tool-doc.html · The same pK values are available in code in Biopython's `Bio.SeqUtils.IsoelectricPoint` module: https://biopython.org/ |
| **UniProt** | real human protein sequences and annotations (e.g. where the transmembrane helices are) | Website: https://www.uniprot.org/ · API help: https://www.uniprot.org/help/api · Example (rhodopsin, 348 aa): `https://rest.uniprot.org/uniprotkb/P08100.fasta` · with annotations: `https://rest.uniprot.org/uniprotkb/P08100.json` |

### Genetic code and translation module

| Source | What we take from it | Link / access |
|---|---|---|
| **NCBI genetic codes** | the standard genetic code (table 1): which codon codes for which amino acid, start and stop codons | https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi |
| **Ensembl REST API** | real human genes, their main transcript and its mRNA / coding sequence (GRCh38) | Docs: https://rest.ensembl.org/ · Find a gene: `https://rest.ensembl.org/lookup/symbol/homo_sapiens/TP53?content-type=application/json` · Coding sequence only (starts at the ATG): `https://rest.ensembl.org/sequence/id/ENST00000269305?type=cds;content-type=text/plain` · Full mRNA sequence including the untranslated 5′ part (needed for the "find the start codon" game): `https://rest.ensembl.org/sequence/id/ENST00000269305?type=cdna;content-type=text/plain` · Ensembl returns DNA letters (T), so we replace T with U to show mRNA |
| **MANE Select (NCBI + Ensembl)** | the one agreed "main" transcript per human gene, so we always translate the right one | https://www.ncbi.nlm.nih.gov/refseq/MANE/ · downloads: https://ftp.ncbi.nlm.nih.gov/refseq/MANE/MANE_human/current/ |

### Tools we use to check our results

| Tool | What we compare against | Link |
|---|---|---|
| **ExPASy ProtParam** | molecular weight, isoelectric point, amino acid composition, GRAVY of a protein | https://web.expasy.org/protparam/ |
| **Biopython** | translation of DNA/RNA to protein, protein properties (`ProteinAnalysis`) | https://biopython.org/ |
| **UniProt protein sequence** | our translation of a coding sequence must be identical to it | https://www.uniprot.org/ |

Scores and progress are stored only in the user's own browser (local storage),
so the app keeps no personal data and nothing about users is sent to an AI model.

## 3. Correct means

We know the output is right when it matches trusted references:

- Exactly 20 standard amino acids, each with a correct and unique one- and three-letter code.
- Masses and formulas match PubChem.
- Hydrophobicity values match the published Kyte–Doolittle table (isoleucine highest, arginine lowest).
- Charge at pH 7: aspartate and glutamate negative, lysine and arginine positive.
- Genetic code: 64 codons, 61 code for the 20 amino acids and 3 are stops (UAA, UAG, UGA); methionine has one codon, leucine, serine and arginine have six.
- Our translation of a real coding sequence is identical to the protein sequence in UniProt, starts with methionine and ends at a stop codon.
- A hydropathy plot of a known membrane protein (rhodopsin) shows peaks where UniProt annotates its transmembrane helices.
- Every quiz answer comes from the data table, never written by hand or by the AI.
- Scoring and relearning are tested: a correct answer adds the right points, a wrong answer puts the question back
  into the "practise more" group, and a question answered correctly several times in a row moves to "mastered".
- Progress is saved: after closing and reopening the app in the same browser, the score and progress are unchanged, and a "reset progress" button clears them.

## 4. First step

A table of the 20 amino acids (name, codes, class, charge, hydrophobicity, codons) checked against the references above,
and a simple command-line quiz: "one-letter code → name".
