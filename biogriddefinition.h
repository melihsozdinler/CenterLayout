#ifndef BIOGRIDDEFINITION_H
#define BIOGRIDDEFINITION_H

#include <string>
#include <algorithm>
#include <QList>

using namespace std;


class CQueryResultExp{
   public:
       QString source;
       QString experiment;
       QString pubmedid;
       int count;
};

class CQueryResultInteractors{
   public:
       QString protein;
       int count;
};

class CQueryResultInteractions{
   public:
       QString geneA;
       QString geneB;
       QString source;
       QString experiment;
       QString pubmedid;
       int count;
};

namespace species
{
    /*
        Anopheles_gambiae
                Apis_mellifera
                Arabidopsis_thaliana
                Aspergillus_nidulans
                Bacillus_subtilis_168
                Biogrid3_0_all.zip
                Bos_taurus
                Caenorhabditis_elegans
                Candida_albicans_SC5314
                Canis_familiaris
                Cavia_porcellus
                Chlamydomonas_reinhardtii
                Cricetulus_griseus
                Danio_rerio
                declerations.h
                Dictyostelium_discoideum_AX4
                Drosophila_melanogaster
                Equus_caballus
                Escherichia_coli
                Gallus_gallus
                Glycine_max
                Hepatitus_C_Virus
                Homo_sapiens
                Human_Herpesvirus_1
                Human_Herpesvirus_2
                Human_Herpesvirus_3
                Human_Herpesvirus_4
                Human_Herpesvirus_5
                Human_Herpesvirus_6
                Human_Herpesvirus_8
                Human_Immunodeficiency_Virus_1
                Human_Immunodeficiency_Virus_2
                Leishmania_major
                Macaca_mulatta
                Mus_musculus
                Neurospora_crassa
                Oryctolagus_cuniculus
                Oryza_sativa
                Pan_troglodytes
                Plasmodium_falciparum_3D7
                Rattus_norvegicus
                Ricinus_communis
                Saccharomyces_cerevisiae
                Schizosaccharomyces_pombe
                Simian-Human_Immunodeficiency_Virus
                Strongylocentrotus_purpuratus
                Sus_scrofa
                Ustilago_maydis
                Xenopus_laevis
                Zea_mays

        code name preferred name taxid
        1 Arabidopsis thaliana  3702
        3 Bacillus subtilis 168
        1 Bos taurus  9913
        1 Caenorhabditis elegans  6239
        1 Candida albicans SC5314  237561
        2 Canis familiaris Canis lupus familiaris 9615
        1 Chlamydomonas reinhardtii  3055
        1 Danio rerio  7955
        1 Drosophila melanogaster  7227
        3 Escherichia coli K12 MG1655
        1 Gallus gallus  9031
        3 Hepatitus C Virus
        1 Homo sapiens  9606
        1 Human Herpesvirus 1 Human herpesvirus 1 10298
        1 Human Herpesvirus 4 Human herpesvirus 4 10376
        1 Human Herpesvirus 8 Type M Human herpesvirus 8 type M 435895
        1 Macaca mulatta  9544
        1 Mus musculus  10090
        1 Human Immunodeficiency Virus 1 Human immunodeficiency virus 1 11676
        1 Oryctolagus cuniculus  9986
        1 Plasmodium falciparum 3D7  36329
        1 Rattus norvegicus  10116
        1 Saccharomyces cerevisiae  4932
        1 Schizosaccharomyces pombe  4896
        1 Sus scrofa  9823
        1 Xenopus laevis  8355
        1 Zea mays  4577
    */
    const std::pair<string,int> Select_Species("Select Species",-1);
    const std::pair<string,int> Anopheles_gambiae("Anopheles gambiae",0);
    const std::pair<string,int> Apis_mellifera("Apis mellifera",0);
    const std::pair<string,int> Arabidopsis_thaliana("Arabidopsis thaliana",3702);
    const std::pair<string,int> Aspergillus_nidulans("Aspergillus nidulans",0);
    const std::pair<string,int> Bacillus_subtilis("Bacillus Subtilis 168", 168);
    const std::pair<string,int> Bos_taurus("Bos Taurus", 9913);
    const std::pair<string,int> Caenorhabditis_elegans("Caenorhabditis elegans", 6239);
    const std::pair<string,int> Candida_albicans("Candida albicans SC5314", 237561);
    const std::pair<string,int> Canis_familiaris("Canis familiaris", 9615);
    const std::pair<string,int> Cavia_porcellus("Cavia porcellus", 0);
    const std::pair<string,int> Chlamydomonas_reinhardtii("Chlamydomonas reinhardtii", 3055);
    const std::pair<string,int> Cricetulus_griseus("Cricetulus griseus",0);
    const std::pair<string,int> Danio_rerio("Danio rerio", 7955);
    const std::pair<string,int> Dictyostelium_discoideum_AX4("Dictyostelium discoideum AX4",0);
    const std::pair<string,int> Drosophila_melanogaster("Drosophila melanogaster", 7227);
    const std::pair<string,int> Equus_caballus("Equus caballus",0);
    const std::pair<string,int> Escherichia_coli("Escherichia coli",0);
    const std::pair<string,int> Gallus_gallus("Gallus gallus", 9031);
    const std::pair<string,int> Glycine_max("Glycine max",0);
    const std::pair<string,int> Hepatitus_C_Virus("Hepatitus C Virus",0);
    const std::pair<string,int> Homo_sapiens("Homo sapiens", 9606);
    const std::pair<string,int> Human_Herpesvirus1("Human Herpesvirus 1", 10298);
    const std::pair<string,int> Human_Herpesvirus2("Human Herpesvirus 2",0);
    const std::pair<string,int> Human_Herpesvirus3("Human Herpesvirus 3",0);
    const std::pair<string,int> Human_Herpesvirus4("Human Herpesvirus 4", 10376);
    const std::pair<string,int> Human_Herpesvirus5("Human Herpesvirus 5",0);
    const std::pair<string,int> Human_Herpesvirus6("Human Herpesvirus 6",0);
    const std::pair<string,int> Human_Herpesvirus8("Human Herpesvirus 8", 435895);
    const std::pair<string,int> Human_Immunodeficiency_Virus1("Human Immunodeficiency Virus 1", 11676);
    const std::pair<string,int> Human_Immunodeficiency_Virus2("Human Immunodeficiency Virus 2",0);
    const std::pair<string,int> Leishmania_major("Leishmania major",0);
    const std::pair<string,int> Macaca_mulatta("Macaca mulatta", 9544);
    const std::pair<string,int> Mus_musculus("Mus musculus", 10090);
    const std::pair<string,int> Neurospora_crassa("Neurospora crassa",0);
    const std::pair<string,int> Oryctolagus_cuniculus("Oryctolagus cuniculus",  9986);
    const std::pair<string,int> Oryza_sativa("Oryza sativa",0);
    const std::pair<string,int> Pan_troglodytes("Pan troglodytes",0);
    const std::pair<string,int> Plasmodium_falciparum("Plasmodium falciparum 3D7", 36329);
    const std::pair<string,int> Rattus_norvegicus("Rattus norvegicus", 10116);
    const std::pair<string,int> Ricinus_communis("Ricinus communis",0);
    const std::pair<string,int> Saccharomyces_cerevisiae("Saccharomyces cerevisiae", 4932);
    const std::pair<string,int> Schizosaccharomyces_pombe("Schizosaccharomyces pombe", 4896);
    const std::pair<string,int> Simian_Human_Immunodeficiency_Virus("Simian-Human Immunodeficiency Virus",0);
    const std::pair<string,int> Strongylocentrotus_purpuratus("Strongylocentrotus purpuratus",0);
    const std::pair<string,int> Sus_scrofa("Sus scrofa", 9823);
    const std::pair<string,int> Ustilago_maydis("Ustilago maydis",0);
    const std::pair<string,int> Xenopus_laevis("Xenopus laevis", 8355);
    const std::pair<string,int> Zea_mays("Zea mays", 4577);
}

namespace experimentTypes
{
     namespace physical
     {
         /*
         Affinity Capture-Luminescence - An interaction is inferred when a bait protein, tagged with luciferase, is enzymatically detected in immunoprecipitates of the prey protein as light emission. The prey protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag.
         Affinity Capture-MS - An interaction is inferred when a “bait” protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag and the associated interaction partner is identified by mass spectrometric methods.
         Affinity Capture-RNA - An interaction is inferred when a bait protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag and associated RNA species identified by Northern blot, RT-PCR, affinity labeling, sequencing, or microarray analysis.
         Affinity Capture-Western - An interaction is inferred when a Bait protein affinity captured from cell extracts by either polyclonal antibody or epitope tag and the associated interaction partner identified by Western blot with a specific polyclonal antibody or second epitope tag. This category is also used if an interacting protein is visualized directly by dye stain or radioactivity. Note that this differs from any co-purification experiment involving affinity capture in that the co-purification experiment involves at least one extra purification step to get rid of potential contaminating proteins.
         Biochemical Activity - An interaction is inferred from the biochemical effect of one protein upon another, for example, GTP-GDP exchange activity or phosphorylation of a substrate by a kinase. The “bait” protein executes the activity on the substrate “hit” protein. A Modification value is recorded for interactions of this type with the possible values Phosphorylation, Ubiquitination, Sumoylation, Dephosphorylation, Methylation, Prenylation, Acetylation, Deubiquitination, Proteolytic Processing, Glucosylation, Nedd(Rub1)ylation, Deacetylation, No Modification, Demethylation.
         Co-crystal Structure - Interaction directly demonstrated at the atomic level by X-ray crystallography. Also used for NMR or Electron Microscopy (EM) structures. If a structure is demonstrated between 3 or more proteins, one is chosen as the bait and binary interactions are recorded between that protein and the others.
         Co-fractionation - Interaction inferred from the presence of two or more protein subunits in a partially purified protein preparation. If co-fractionation is demonstrated between 3 or more proteins, one is chosen as the bait and binary interactions are recorded between that protein and the others.
         Co-localization - An interaction is inferred from co-localization of two proteins in the cell, including co-dependent association of proteins with promoter DNA in chromatin immunoprecipitation experiments.
         Co-purification - An interaction is inferred from the identification of two or more protein subunits in a purified protein complex, as obtained by classical biochemical fractionation or affinity purification and one or more additional fractionation steps.
         Far Western - An interaction is detected between a protein immobilized on a membrane and a purified protein probe.
         FRET - An interaction is inferred when close proximity of interaction partners is detected by fluorescence resonance energy transfer between pairs of fluorophore-labeled molecules, such as occurs between CFP (donor) and YFP (acceptor) fusion proteins.
         PCA - A Protein-Fragment Complementation Assay (PCA) is a protein-protein interaction assay in which a bait protein is expressed as fusion to one of the either N- or C- terminal peptide fragments of a reporter protein and prey protein is expressed as fusion to the complementary N- or C- terminal fragment of the same reporter protein. Interaction of bait and prey proteins bring together complementary fragments, which can then fold into an active reporter, e.g. the split-ubiquitin assay.
         Protein-peptide - An interaction is detected between a protein and a peptide derived from an interaction partner. This includes phage display experiments.
         Protein-RNA - An interaction is detected between and protein and an RNA.
         Reconstituted Complex - An interaction is detected between purified proteins in vitro.
         Two-hybrid - Bait protein expressed as a DNA binding domain (DBD) fusion and prey expressed as a transcriptional activation domain (TAD) fusion and interaction measured by reporter gene activation.
         */
         const int SIZE = 16;
                 //Select Physical Evidence
         const string TYPE_NAME[] = {
                      "Affinity Capture-Luminescence",
                      "Affinity Capture-MS",
                      "Affinity Capture-RNA",
                      "Affinity Capture-Western",
                      "Biochemical Activity",
                      "Co-crystal Structure",
                      "Co-fractionation",
                      "Co-localization",
                      "Co-purification",
                      "Far Western",
                      "FRET",
                      "PCA",
                      "Protein-peptide",
                      "Protein-RNA",
                      "Reconstituted Complex",
                      "Two-hybrid"
         };
                 //Select Physical Evidence
         const string TYPE_DEFINITION[] = {
                      "An interaction is inferred when a bait protein, tagged with luciferase, is enzymatically detected in immunoprecipitates of the prey protein as light emission. The prey protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag.",
                      "An interaction is inferred when a bait protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag and associated RNA species identified by Northern blot, RT-PCR, affinity labeling, sequencing, or microarray analysis.",
                      "An interaction is inferred when a bait protein is affinity captured from cell extracts by either polyclonal antibody or epitope tag and associated RNA species identified by Northern blot, RT-PCR, affinity labeling, sequencing, or microarray analysis.",
                      "An interaction is inferred when a Bait protein affinity captured from cell extracts by either polyclonal antibody or epitope tag and the associated interaction partner identified by Western blot with a specific polyclonal antibody or second epitope tag. This category is also used if an interacting protein is visualized directly by dye stain or radioactivity. Note that this differs from any co-purification experiment involving affinity capture in that the co-purification experiment involves at least one extra purification step to get rid of potential contaminating proteins.",
                      "An interaction is inferred from the biochemical effect of one protein upon another, for example, GTP-GDP exchange activity or phosphorylation of a substrate by a kinase. The “bait” protein executes the activity on the substrate “hit” protein. A Modification value is recorded for interactions of this type with the possible values Phosphorylation, Ubiquitination, Sumoylation, Dephosphorylation, Methylation, Prenylation, Acetylation, Deubiquitination, Proteolytic Processing, Glucosylation, Nedd(Rub1)ylation, Deacetylation, No Modification, Demethylation.",
                      "Interaction directly demonstrated at the atomic level by X-ray crystallography. Also used for NMR or Electron Microscopy (EM) structures. If a structure is demonstrated between 3 or more proteins, one is chosen as the bait and binary interactions are recorded between that protein and the others.",
                      "Interaction inferred from the presence of two or more protein subunits in a partially purified protein preparation. If co-fractionation is demonstrated between 3 or more proteins, one is chosen as the bait and binary interactions are recorded between that protein and the others.",
                      "An interaction is inferred from co-localization of two proteins in the cell, including co-dependent association of proteins with promoter DNA in chromatin immunoprecipitation experiments.",
                      "An interaction is inferred from the identification of two or more protein subunits in a purified protein complex, as obtained by classical biochemical fractionation or affinity purification and one or more additional fractionation steps.",
                      "An interaction is detected between a protein immobilized on a membrane and a purified protein probe.",
                      "An interaction is inferred when close proximity of interaction partners is detected by fluorescence resonance energy transfer between pairs of fluorophore-labeled molecules, such as occurs between CFP (donor) and YFP (acceptor) fusion proteins.",
                      "A Protein-Fragment Complementation Assay (PCA) is a protein-protein interaction assay in which a bait protein is expressed as fusion to one of the either N- or C- terminal peptide fragments of a reporter protein and prey protein is expressed as fusion to the complementary N- or C- terminal fragment of the same reporter protein. Interaction of bait and prey proteins bring together complementary fragments, which can then fold into an active reporter, e.g. the split-ubiquitin assay.",
                      "An interaction is detected between a protein and a peptide derived from an interaction partner. This includes phage display experiments.",
                      "An interaction is detected between and protein and an RNA.",
                      "An interaction is detected between purified proteins in vitro.",
                      "Bait protein expressed as a DNA binding domain (DBD) fusion and prey expressed as a transcriptional activation domain (TAD) fusion and interaction measured by reporter gene activation."
         };
     }
     namespace genetic
     {
         /*
         Dosage Growth Defect - A genetic interaction is inferred when over expression or increased dosage of one gene causes a growth defect in a strain that is mutated or deleted for another gene.
         Dosage Lethality - A genetic interaction is inferred when over expression or increased dosage of one gene causes lethality in a strain that is mutated or deleted for another gene.
         Dosage Rescue - A genetic interaction is inferred when over expression or increased dosage of one gene rescues the lethality or growth defect of a strain that is mutated or deleted for another gene.
         Negative Genetic - Mutations/deletions in separate genes, each of which alone causes a minimal phenotype, but when combined in the same cell results in a more severe fitness defect or lethality under a given condition.
         Phenotypic Enhancement - A genetic interaction is inferred when mutation or overexpression of one gene results in enhancement of any phenotype (other than lethality/growth defect) associated with mutation or over expression of another gene.
         Phenotypic Suppression - A genetic interaction is inferred when mutation or over expression of one gene results in suppression of any phenotype (other than lethality/growth defect) associated with mutation or over expression of another gene.
         Positive Genetic - Mutations/deletions in separate genes, each of which alone causes a minimal phenotype, but when combined in the same cell results in a less severe fitness defect than expected under a given condition.
         Synthetic Growth Defect - A genetic interaction is inferred when mutations in separate genes, each of which alone causes a minimal phenotype, result in a significant growth defect under a given condition when combined in the same cell.
         Synthetic Haploinsufficiency - A genetic interaction is inferred when mutations or deletions in separate genes, at least one of which is hemizygous, cause a minimal phenotype alone but result in lethality when combined in the same cell under a given condition.
         Synthetic Lethality - A genetic interaction is inferred when mutations or deletions in separate genes, each of which alone causes a minimal phenotype, result in lethality when combined in the same cell under a given condition.
         Synthetic Rescue - A genetic interaction is inferred when mutations or deletions of one gene rescues the lethality or growth defect of a strain mutated or deleted for another gene.
         */
         const int SIZE = 11;
                 //Select Genetic Evidence
         const string TYPE_NAME[] = {
                                          "Dosage Growth Defect",
                                          "Dosage Lethality",
                                          "Dosage Rescue",
                                          "Negative Genetic",
                                          "Phenotypic Enhancement",
                                          "Phenotypic Suppression",
                                          "Positive Genetic",
                                          "Synthetic Growth Defect",
                                          "Synthetic Haploinsufficiency",
                                          "Synthetic Lethality",
                                          "Synthetic Rescue"
                 };
                 //Select Genetic Evidence
                 const string TYPE_DEFINITION[] = {
                      "A genetic interaction is inferred when over expression or increased dosage of one gene causes a growth defect in a strain that is mutated or deleted for another gene.",
                      "A genetic interaction is inferred when over expression or increased dosage of one gene causes lethality in a strain that is mutated or deleted for another gene.",
                      "A genetic interaction is inferred when over expression or increased dosage of one gene rescues the lethality or growth defect of a strain that is mutated or deleted for another gene.",
                      "Mutations/deletions in separate genes, each of which alone causes a minimal phenotype, but when combined in the same cell results in a more severe fitness defect or lethality under a given condition.",
                      "A genetic interaction is inferred when mutation or over expression of one gene results in enhancement of any phenotype (other than lethality/growth defect) associated with mutation or over expression of another gene.",
                      "A genetic interaction is inferred when mutation or over expression of one gene results in suppression of any phenotype (other than lethality/growth defect) associated with mutation or over expression of another gene.",
                      "Mutations/deletions in separate genes, each of which alone causes a minimal phenotype, but when combined in the same cell results in a less severe fitness defect than expected under a given condition.",
                      "A genetic interaction is inferred when mutations in separate genes, each of which alone causes a minimal phenotype, result in a significant growth defect under a given condition when combined in the same cell.",
                      "A genetic interaction is inferred when mutations or deletions in separate genes, at least one of which is hemizygous, cause a minimal phenotype alone but result in lethality when combined in the same cell under a given condition.",
                      "A genetic interaction is inferred when mutations or deletions in separate genes, each of which alone causes a minimal phenotype, result in lethality when combined in the same cell under a given condition.",
                      "A genetic interaction is inferred when mutations or deletions of one gene rescues the lethality or growth defect of a strain mutated or deleted for another gene."
                 };
     }
}

#endif // BIOGRIDDEFINITION_H
