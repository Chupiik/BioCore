"""Build data/amino_acids.json for the Amino acids module.

Sources (also written to data/sources.json):
  * one- and three-letter codes: Biopython (IUPAC-IUBMB tables)
  * name, formula, molecular weight, SMILES: NCBI PubChem (PUG REST)
  * Kyte-Doolittle hydropathy index: Biopython (Bio.SeqUtils.ProtParamData.kd)
  * side-chain pKa: Biopython Bio.SeqUtils.IsoelectricPoint (the pK set used by ExPASy Compute pI/Mw)
  * hydropathy / chemical / charge classes: IMGT (Pommie et al. 2004, J Mol Recognit 17:17-32)
  * indispensable / conditionally indispensable / dispensable: WHO/FAO/UNU TRS 935 (2007)
  * Czech and Slovak names: titles of the cs / sk Wikipedia articles (via the English article's
    language links)

Typed by hand: the PubChem CIDs, the IMGT classes and the WHO classes below. The script checks
each of them (CIDs against the PubChem title, IMGT hydropathy against the Kyte-Doolittle values,
every class table against the full set of 20) and stops if anything does not fit.

Run:  .venv/bin/python build_data.py
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from Bio.SeqUtils import IUPACData
from Bio.SeqUtils.IsoelectricPoint import negative_pKs, positive_pKs
from Bio.SeqUtils.ProtParamData import kd

# three-letter code -> PubChem CID of the L-amino acid
CIDS = {
    "Ala": 5950, "Arg": 6322, "Asn": 6267, "Asp": 5960, "Cys": 5862,
    "Gln": 5961, "Glu": 33032, "Gly": 750, "His": 6274, "Ile": 6306,
    "Leu": 6106, "Lys": 5962, "Met": 6137, "Phe": 6140, "Pro": 145742,
    "Ser": 5951, "Thr": 6288, "Trp": 6305, "Tyr": 6057, "Val": 6287,
}

# used only to verify the CIDs above, never as a data source
EXPECTED_NAMES = {
    "Ala": "Alanine", "Arg": "Arginine", "Asn": "Asparagine", "Asp": "Aspartic acid",
    "Cys": "Cysteine", "Gln": "Glutamine", "Glu": "Glutamic acid", "Gly": "Glycine",
    "His": "Histidine", "Ile": "Isoleucine", "Leu": "Leucine", "Lys": "Lysine",
    "Met": "Methionine", "Phe": "Phenylalanine", "Pro": "Proline", "Ser": "Serine",
    "Thr": "Threonine", "Trp": "Tryptophan", "Tyr": "Tyrosine", "Val": "Valine",
}

# IMGT classes of the 20 amino acids, one-letter codes
# https://www.imgt.org/IMGTeducation/Aide-memoire/_UK/aminoacids/IMGTclasses.html
IMGT_HYDROPATHY = {
    "hydrophobic": "ACILMFWV",
    "neutral": "GHPSTY",
    "hydrophilic": "RNDQEK",
}
IMGT_CHEMICAL = {
    "aliphatic": "AGILPV",
    "aromatic": "FWY",
    "sulfur": "CM",
    "hydroxyl": "ST",
    "basic": "RHK",
    "acidic": "DE",
    "amide": "NQ",
}
IMGT_CHARGE = {
    "positive": "RHK",
    "negative": "DE",
    "uncharged": "ACFGILMNPQSTVWY",
}

# WHO/FAO/UNU, Protein and amino acid requirements in human nutrition, TRS 935 (2007), p. 29-30
# and Table 23. The report lists taurine as well, which is not one of the 20 amino acids.
# https://iris.who.int/handle/10665/43411
WHO_NUTRITION = {
    "indispensable": "HILKMFTWV",
    "conditionally indispensable": "CYGRQP",
    "dispensable": "DNEAS",
}

SOURCES = {
    "codes": "Biopython Bio.SeqUtils.IUPACData (IUPAC-IUBMB)",
    "name, formula, mass, smiles": "NCBI PubChem PUG REST, https://pubchem.ncbi.nlm.nih.gov/",
    "kyte_doolittle": "Kyte & Doolittle 1982, J Mol Biol 157:105-132, via Biopython Bio.SeqUtils.ProtParamData.kd",
    "side_chain_pka": "Biopython Bio.SeqUtils.IsoelectricPoint (pK set of Bjellqvist et al., as used by "
        "ExPASy Compute pI/Mw, https://web.expasy.org/compute_pi/pi_tool-doc.html)",
    "imgt_hydropathy, imgt_chemical, imgt_charge": "IMGT, Pommie et al. 2004, J Mol Recognit 17:17-32; "
        "https://www.imgt.org/IMGTeducation/Aide-memoire/_UK/aminoacids/IMGTclasses.html",
    "nutrition": "WHO/FAO/UNU TRS 935 (2007), https://iris.who.int/handle/10665/43411",
    "name_cs, name_sk": "Czech / Slovak Wikipedia article titles (language links of the English article). "
        "Not an official IUPAC or standards-body list.",
}

PUBCHEM_URL = ("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cids}"
               "/property/Title,MolecularFormula,MolecularWeight,IsomericSMILES/JSON")
WIKIPEDIA_URL = ("https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
                 "&prop=langlinks&lllimit=500&lllang={lang}&titles={titles}")
USER_AGENT = {"User-Agent": "BioCore-student-project/0.1"}
OUT = Path(__file__).parent / "data" / "amino_acids.json"
SOURCES_OUT = Path(__file__).parent / "data" / "sources.json"


def fetch(cids):
    url = PUBCHEM_URL.format(cids=",".join(str(c) for c in cids))
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.load(resp)["PropertyTable"]["Properties"]


def fetch_wikipedia_titles(english_names, lang):
    """English article title -> title of the same article in `lang` (cs or sk)."""
    url = WIKIPEDIA_URL.format(lang=lang, titles=urllib.parse.quote("|".join(english_names)))
    req = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(req, timeout=30) as resp:
        query = json.load(resp)["query"]
    follow = {}
    for key in ("normalized", "redirects"):
        follow.update({x["from"]: x["to"] for x in query.get(key, [])})
    links = {p["title"]: p.get("langlinks") for p in query["pages"].values()}
    titles = {}
    for name in english_names:
        title = name
        for _ in range(2):  # the API may normalise the title and then follow a redirect
            title = follow.get(title, title)
        link = links.get(title)
        assert link, f"no {lang} Wikipedia article linked from English '{name}'"
        titles[name] = link[0]["*"]
    return titles


def class_lookup(classes, label):
    """Turn {"class": "ACD"} into {"A": "class", ...}, checking it covers each of the 20 exactly once."""
    lookup = {letter: cls for cls, letters in classes.items() for letter in letters}
    total = sum(len(letters) for letters in classes.values())
    assert total == 20 and len(lookup) == 20, f"{label}: each amino acid must be in exactly one class"
    return lookup


def check_imgt_hydropathy_against_kd(hydropathy):
    """IMGT: hydrophobic >= 1.8, hydrophilic <= -3.5 (Kyte-Doolittle); Trp is a stated exception."""
    for letter, cls in hydropathy.items():
        value = kd[letter]
        if letter == "W":
            assert cls == "hydrophobic"
        elif cls == "hydrophobic":
            assert value >= 1.8, f"{letter}: {value} is not hydrophobic"
        elif cls == "hydrophilic":
            assert value <= -3.5, f"{letter}: {value} is not hydrophilic"
        else:
            assert -3.5 < value < 1.8, f"{letter}: {value} is not neutral"


def side_chain_pka(letter):
    """{"value": pKa, "group": "positive" | "negative"} for the 7 ionisable side chains, else None."""
    if letter in positive_pKs:
        return {"value": positive_pKs[letter], "group": "positive"}
    if letter in negative_pKs:
        return {"value": negative_pKs[letter], "group": "negative"}
    return None


def main():
    three_to_one = IUPACData.protein_letters_3to1
    assert set(three_to_one) == set(CIDS), "CID table must cover exactly the 20 standard amino acids"

    hydropathy = class_lookup(IMGT_HYDROPATHY, "IMGT hydropathy")
    chemical = class_lookup(IMGT_CHEMICAL, "IMGT chemical")
    charge = class_lookup(IMGT_CHARGE, "IMGT charge")
    nutrition = class_lookup(WHO_NUTRITION, "WHO nutrition")
    check_imgt_hydropathy_against_kd(hydropathy)
    ionisable = {l for l in list(positive_pKs) + list(negative_pKs) if len(l) == 1}
    assert ionisable == set("KRHDECY"), f"unexpected ionisable side chains: {ionisable}"

    props = {p["CID"]: p for p in fetch(CIDS.values())}
    english = list(EXPECTED_NAMES.values())
    cs = fetch_wikipedia_titles(english, "cs")
    sk = fetch_wikipedia_titles(english, "sk")

    rows = []
    for three, cid in CIDS.items():
        p = props[cid]
        title = p["Title"]
        # PubChem titles vary: "L-Alanine", "(-)-Asparagine", "L-(+)-Cysteine", "L-Aspartic Acid"
        name = re.sub(r"^(L-)?(\([+-]\)-)?", "", title).capitalize()
        assert name == EXPECTED_NAMES[three], f"CID {cid} is '{title}', expected {EXPECTED_NAMES[three]}"
        one = three_to_one[three]
        rows.append({
            "name": name,
            "name_cs": cs[name],
            "name_sk": sk[name],
            "three": three,
            "one": one,
            "formula": p["MolecularFormula"],
            "mass": float(p["MolecularWeight"]),
            "smiles": p.get("IsomericSMILES") or p.get("SMILES"),
            "pubchem_cid": cid,
            "kyte_doolittle": kd[one],
            "side_chain_pka": side_chain_pka(one),
            "imgt_hydropathy": hydropathy[one],
            "imgt_chemical": chemical[one],
            "imgt_charge": charge[one],
            "nutrition": nutrition[one],
        })

    rows.sort(key=lambda r: r["name"])
    assert len(rows) == 20
    for key in ("name", "name_cs", "name_sk", "three", "one"):
        assert len({r[key] for r in rows}) == 20, f"{key} values are not unique"

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")
    SOURCES_OUT.write_text(json.dumps(SOURCES, indent=2, ensure_ascii=False) + "\n")
    for r in rows:
        print(f"{r['one']} {r['three']} {r['name']:<14} {r['name_cs']:<20} {r['name_sk']:<20} "
              f"{r['kyte_doolittle']:>5} {r['imgt_hydropathy']:<12} {r['imgt_chemical']:<9} "
              f"{r['imgt_charge']:<9} {r['nutrition']}")
    print(f"\nWrote {len(rows)} amino acids to {OUT}")


if __name__ == "__main__":
    main()
