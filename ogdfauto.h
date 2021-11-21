#ifndef OGDFAUTO_H
#define OGDFAUTO_H

/*#include <ogdf/basic/Graph.h>
#include <ogdf/basic/graph_generators.h>
#include <ogdf/energybased/FMMMLayout.h>
#include <ogdf/layered/DfsAcyclicSubgraph.h>

using namespace ogdf;

void graphC(){

    Graph G;
    randomSimpleGraph(G, 10, 20);
    DfsAcyclicSubgraph DAS;
    DAS.callAndReverse(G);
    GraphAttributes GA(G);
    node v;
    forall_nodes(v,G)
            GA.width(v) = GA.height(v) = 10.0;

    FMMMLayout fmmm;

    fmmm.useHighLevelOptions(true);
    fmmm.unitEdgeLength(15.0);
    fmmm.newInitialPlacement(true);
    fmmm.qualityVersusSpeed(FMMMLayout::qvsGorgeousAndEfficient);

    fmmm.call(GA);
    GA.writeGML("D:\\layout.gml");
}
*/
#endif // OGDFAUTO_H
