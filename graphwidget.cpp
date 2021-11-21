//************************************************************************************
/**	Copyright (C) <2013>  <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**							                  
**    This program is free software: you can redistribute it and/or modify
**    it under the terms of the GNU General Public License as published by
**    the Free Software Foundation, either version 3 of the License, or	
**    (at your option) any later version.				
**								        
**    This program is distributed in the hope that it will be useful,	
**    but WITHOUT ANY WARRANTY; without even the implied warranty of	
**    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the	
**    GNU General Public License for more details.			
**									
**    You should have received a copy of the GNU General Public License    
**    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**							
**    This .cpp file is created and implemented by       
**     <Melih Sozdinler,Turkan Haliloglu and Can Ozturan>
**     Copyright (C)<2013>
**    This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
**    This is free software, and you are welcome to redistribute it                 
**    under certain conditions; type `show c' for details.                          
************************************************************************************/
/**
 ** Copyright (C) 2004-2007 Trolltech ASA. All rights reserved.
 **
 ** This file is part of the example classes of the Qt Toolkit.
 **
 ** This file may be used under the terms of the GNU General Public
 ** License version 2.0 as published by the Free Software Foundation
 ** and appearing in the file LICENSE.GPL included in the packaging of
 ** this file.  Please review the following information to ensure GNU
 ** General Public Licensing requirements will be met:
 ** http://www.trolltech.com/products/qt/opensource.html
 **
 ** If you are unsure which license is appropriate for your use, please
 ** review the following information:
 ** http://www.trolltech.com/products/qt/licensing.html or contact the
 ** sales department at sales@trolltech.com.
 **
 ** This file is provided AS IS with NO WARRANTY OF ANY KIND, INCLUDING THE
 ** WARRANTY OF DESIGN, MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.
 **
 ************************************************************************************/

#include "graphwidget.h"
#include "layoutwidget.h"
//#include "httpwindow.h"
#include "subgraphwidget.h"
#include "node.h"

#include <QDebug>
#include <QGraphicsScene>
#include <QWheelEvent>
//#include <QPrinter>
#include <QPainter>
#include <QDialog>

#include <QMainWindow>
#include <QWidget>
//#include <QWebView>
#include <QFile>
#include <QGridLayout>
#include <QPushButton>
#include <QMenu>
#include <QTableView>
#include <iostream>
#include <fstream>
#include <QFileDialog>

#include <math.h>
using namespace std;

GraphWidget::GraphWidget(QString &in_strFilename)
    : timerId(0)
{
    printf( "done3\n");
    QGraphicsScene *scene = new QGraphicsScene(this);
    scene->setItemIndexMethod(QGraphicsScene::NoIndex);
    setScene(scene);
    setCacheMode(CacheBackground);
    setViewportUpdateMode(BoundingRectViewportUpdate);
    setRenderHint(QPainter::Antialiasing);
    setTransformationAnchor(AnchorUnderMouse);
    setResizeAnchor(AnchorViewCenter);

    QList<QPair<Node*,Node*> > edgeList;
    QMap<Node*,int> nodeEdgeCount;
    QMap<int,QString> mapOfLabels;

    double xcoord=0,ycoord=0,xcoord2=0,ycoord2=0;
    double xcoord_min=-1*INT_MAX,ycoord_min=-1*INT_MAX,xcoord_max=0,ycoord_max=0;
    int count = 0;
    char labelName[256], labelName2[256] ,line[256];
    int id,react_type=1;
    int number,number2;
    //fscanf( fptr, "%d", &number );
    QFile myReadFile(in_strFilename.toStdString().c_str());

    if (!myReadFile.open(QIODevice::ReadOnly | QIODevice::Text))
        return;

    QTextStream filestream(&myReadFile);

    filestream >> number;
    qDebug(in_strFilename.toStdString().c_str());

    double size1=10.0,size2=10.0;
    while( count != number ){
        filestream >> labelName;
//        printf( "%d %d %d %s %s", count, number2, id , labelName, labelName2);
        int count2 = 0;
        filestream >> xcoord >> ycoord;

        qDebug(labelName);
//        printf( "%d %d %lf %lf %s %lf %lf\n", id, react_type, size1, size2, labelName, xcoord, ycoord );
        Node *node1 = NULL;
        // This if/else will differ node size and color according to being main node or experiment
        if ( QString(labelName).toStdString().find("(") != std::string::npos )
        {
            node1 = new Node(this,(size1),(size2), labelName, react_type, xcoord, ycoord );
            node1->setOpacity(0.8);
        }
        else{

            if ( QString(labelName).toStdString().find("Main") != std::string::npos )
            {
                node1 = new Node(this,(size1*2),(size2*2), labelName, 2, xcoord, ycoord );
            }
            else{
                node1 = new Node(this,(size1*2),(size2*2), labelName, 3, xcoord, ycoord );
            }
        }
        scene->addItem(node1);
        node1->setZValue(100);

        node1->setPos((qreal)xcoord, (qreal)ycoord);
        node1->setToolTip(labelName);
        node1->setFlag(QGraphicsItem::ItemIsMovable, true);
//        node1->opacity();
        node1->ensureVisible((qreal)xcoord,(qreal)ycoord,(qreal)size1,(qreal)size2,10,10);
        node1->clicked = false;

        mapNodes[QString(labelName)] = node1;
        nodeEdgeCount[node1] = 0;

        mapOfLabels[count] = QString(labelName);

        Nodes.append(node1);
        // add all item list for grouping
        allItemsGroup.append(node1);
        node1->setAcceptDrops(true);

//        printf( " %lf %lf ", xcoord, ycoord );
        if( count == 0 ){
            xcoord_min = xcoord;
            xcoord_max = xcoord;
            ycoord_min = ycoord;
            ycoord_max = ycoord;
        }
        else{
            if( xcoord > xcoord_max )
                xcoord_max = xcoord;
            if( xcoord < xcoord_min )
                xcoord_min = ycoord;
            if( ycoord < ycoord_min )
                ycoord_min = ycoord;
            if( ycoord > ycoord_max )
                ycoord_max = ycoord;
        }
        /*
        while( count2 != number ){
            filestream >> xcoord2 >> ycoord2;
//            printf( " %lf %lf\n", xcoord2, ycoord2 );
            if( xcoord2 > xcoord_max )
                xcoord_max = xcoord2;
            if( xcoord2 < xcoord_min )
                xcoord_min = ycoord2;
            if( ycoord2 < ycoord_min )
                ycoord_min = ycoord2;
            if( ycoord2 > ycoord_max )
                ycoord_max = ycoord2;
            count2++;
        }
        */
        //printf( "loop\n" );
        count++;
    }

    filestream >> number;

    count = 0;
    while( count != number ){
//        if( count == number )
//            break;
        filestream >> labelName >> labelName2;
//        printf( "%d %d %s %s ", number2, id , labelName, labelName2);
        int count2 = 1;
        filestream >> id;
//        printf( "%lf %lf ", xcoord, ycoord );
        QPen qpen;
        QColor color;
        if( id == 0 )
                qpen.setColor( QColor(255,0,0) );
        if( id == 7 )
                qpen.setColor( QColor(255,0,255) );
        if( id == 2 )
                qpen.setColor( QColor(255,255,255) );
        if( id == 3 )
                qpen.setColor( QColor(255,255,0) );
        if( id == 4 )
                qpen.setColor( QColor(122,255,122) );
        if( id == 5 )
                qpen.setColor( QColor(255,255,50) );
        if( id == 6 )
                qpen.setColor( QColor(0,255,255) );
        if( id == 1 )
                qpen.setColor( QColor(122,122,122) );
        if( id == 8 )
                qpen.setColor( QColor(10,122,50) );
        if( id == 9 )
                qpen.setColor( QColor(0,0,255) );

        xcoord = mapNodes[QString(labelName)]->xcoord;
        ycoord = mapNodes[QString(labelName)]->ycoord;

        xcoord2 = mapNodes[QString(labelName2)]->xcoord;
        ycoord2 = mapNodes[QString(labelName2)]->ycoord;

        QPair<Node*,Node*> nodesOfEdge;

        nodesOfEdge.first = mapNodes[QString(labelName)];
        nodesOfEdge.second = mapNodes[QString(labelName2)];

        nodeEdgeCount[mapNodes[QString(labelName)]]++;
        nodeEdgeCount[mapNodes[QString(labelName2)]]++;

        edgeList.append(nodesOfEdge);

        Edges.append( QLine(xcoord,ycoord,xcoord2,ycoord2) );
        QPair<QString,QString> label( labelName, labelName2 );
        QPair<QPair<QString,QString>,QLine> labelL(label,QLine(xcoord,ycoord,xcoord2,ycoord2));
        edgeLabel.append(labelL);
        if( xcoord > xcoord_max )
            xcoord_max = xcoord;
        if( xcoord < xcoord_min )
            xcoord_min = ycoord;
        if( ycoord < ycoord_min )
            ycoord_min = ycoord;
        if( ycoord > ycoord_max )
            ycoord_max = ycoord;
        QGraphicsLineItem *tmp_item = scene->addLine(xcoord,ycoord,xcoord2,ycoord2,qpen);
        allItemsGroup.append(tmp_item);
        /*
        while( count2 != number2 ){
            count2++;
            xcoord = xcoord2;
            ycoord = ycoord2;
            myReadFile >> xcoord2 >> ycoord2;
            printf( "%lf %lf", xcoord2, ycoord2 );
            Edges.append( QLine(xcoord,ycoord,xcoord2,ycoord2) );
            scene->addLine(xcoord,ycoord,xcoord2,ycoord2,qpen);
            if( xcoord2 > xcoord_max )
                xcoord_max = xcoord2;
            if( xcoord2 < xcoord_min )
                xcoord_min = ycoord2;
            if( ycoord2 < ycoord_min )
                ycoord_min = ycoord2;
            if( ycoord2 > ycoord_max )
                ycoord_max = ycoord2;
        }
        */
        count++;
    }

    for( int listCount = 0; listCount < nodeEdgeCount.size(); listCount++ )
    {
        //qDebug(QString(nodeEdgeCount[mapNodes[mapOfLabels[listCount]]]).toStdString().c_str());
        qDebug(mapOfLabels[listCount].toStdString().c_str());
    }

    myReadFile.close();
    //scene->setSceneRect( xcoord_min-300, ycoord_min - 300.0, abs(xcoord_max - xcoord_min) + 600.0, abs(ycoord_max - ycoord_min) + 600.0);
    scale(qreal(0.8), qreal(0.8));
    scene->createItemGroup(allItemsGroup);
    setMinimumSize(400, 300);
    /*
    QPrinter *printer = new QPrinter();
    printer->setOrientation( QPrinter::Landscape );
    printer->setPaperSize( QPrinter::A2 );
    printer->setPageSize( QPrinter::A2 );
    printer->setDoubleSidedPrinting(true);
    printer->setOutputFormat(QPrinter::OutputFormat());
    //
    printer->setOutputFileName("outputs/out.pdf");
    QPainter *pdfPainter = new QPainter(printer);
    scene->render(pdfPainter);
    pdfPainter->end();*/
}

void GraphWidget::resizeEvent(){
//    GraphWidget::fitInView(GraphWidget::sceneRect(),Qt::AspectRatioMode );
}

void GraphWidget::exportPDF()
{
        QString fileName = QFileDialog::getSaveFileName(this, "Export JPEG", QString(), "*.jpeg");

        /*
        QPrinter printer(QPrinter::HighResolution);
        printer.setPageSize(QPrinter::A3);
        printer.setOrientation(QPrinter::Landscape);
        printer.setOutputFormat(QPrinter::PdfFormat);
        printer.setOutputFileName(fileName);

        QPainter p(&printer);
        this->scene()->render(&p);
        */

        this->scene()->clearSelection();                                                  // Selections would also render to the file
        this->scene()->setSceneRect(scene()->itemsBoundingRect());                          // Re-shrink the scene to it's bounding contents
        QImage image(scene()->sceneRect().size().toSize(), QImage::Format_ARGB32);  // Create the image with the exact size of the shrunk scene
        image.fill(Qt::transparent);                                              // Start all pixels transparent

        QPainter painter(&image);
        QColor tmp = painter.background().color();
        this->scene()->render(&painter);
        tmp.setGreen(255);
        image.scaled(20000,20000,Qt::KeepAspectRatioByExpanding);
        image.save(fileName);

        painter.end();
}

void GraphWidget::selfProteinVisualization(QString MainNode)
{

    QSqlDatabase db;
    db = QSqlDatabase::addDatabase("QSQLITE");

    QString dbPath = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" + this->organismName + ".db.sqlite";
    qDebug(dbPath.toStdString().c_str());
    db.setDatabaseName(dbPath);
    db.open();

    QSqlQuery query("PRAGMA cache_size = 16384");

    db.exec("BEGIN TRANSACTION;");
    query.exec(
             "SELECT SOURCE, EXPERIMENTSYSTEM, PUBMEDID, GENEA, GENEB "
             "FROM INTERACTIONS "
             "WHERE GENEA = '" + MainNode.replace("_", " ") + "' "
             "OR "
             "GENEB = '" + MainNode.replace("_", " ") + "' "
             "ORDER BY EXPERIMENTSYSTEM;"
    );

    qDebug(QString("SELECT SOURCE, EXPERIMENTSYSTEM, PUBMEDID, GENEA, GENEB "
                   "FROM INTERACTIONS "
                   "WHERE GENEA = '" + MainNode.replace("_", " ") + "' "
                   "OR "
                   "GENEB = '" + MainNode.replace("_", " ") + "' "
                   "ORDER BY EXPERIMENTSYSTEM;").toStdString().c_str());

    QList<CQueryResultInteractions> listQueryResultInts;
    QMap<QString,QList<CQueryResultInteractions> > mapQueryResultExp;
    QList<QString> tmp_listGenes, tmp_listUniqueGenes;
    int iSourceInteractionCount = 0;
    QString strFileName = "";

    while (query.next()) {
        CQueryResultInteractions tmp_oQueryResultInt;
        tmp_oQueryResultInt.source = query.value(0).toString().replace(" ","_");
        tmp_oQueryResultInt.experiment = query.value(1).toString().replace(" ","_");
        tmp_oQueryResultInt.pubmedid = query.value(2).toString();
        tmp_oQueryResultInt.geneA = query.value(3).toString();
        tmp_listGenes.append(tmp_oQueryResultInt.geneA);
        tmp_oQueryResultInt.geneB = query.value(4).toString();
        tmp_listGenes.append(tmp_oQueryResultInt.geneB);
        listQueryResultInts.push_back(tmp_oQueryResultInt);
        qDebug(tmp_oQueryResultInt.geneA.toStdString().c_str());
        if ( iSourceInteractionCount == 0 )
        {
            strFileName = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" +  this->organismName + "/" + tmp_oQueryResultInt.pubmedid;
        }
        iSourceInteractionCount++;
    }

    QFile oReadFile(strFileName.toStdString().c_str());

    if (!oReadFile.open(QIODevice::ReadWrite | QIODevice::Text))
    {
        qDebug("File could not be opened!");
    }
    else
    {
        QTextStream filestream(&oReadFile);
        tmp_listGenes.removeDuplicates();
        filestream << tmp_listUniqueGenes.size() << "\n";

        QList<QString>::iterator iterate = tmp_listUniqueGenes.begin();
        for ( ; iterate != tmp_listUniqueGenes.end(); iterate++ )
        {
            qDebug((*iterate).toStdString().c_str());
            filestream << (*iterate) << "\t"
                       << 10 << "\t"
                       << 10 << "\n";
        }

        filestream << listQueryResultInts.size() << "\n";
        QList<CQueryResultInteractions>::iterator iterateInteractions = listQueryResultInts.begin();
        for ( ; iterateInteractions != listQueryResultInts.end(); iterateInteractions++ )
        {
            filestream << (*iterateInteractions).geneA << "\t"
                       << (*iterateInteractions).geneB << "\n";
        }

        // Close the file
        oReadFile.close();

        // Exec auto layout algorithm
        QString tmp_strGMLFile = "";
        tmp_strGMLFile.append(oReadFile.fileName()).append(".gml");
        QString tmp_strResultFile = "";
        tmp_strResultFile.append(oReadFile.fileName()).append("Result.txt");

        QString strAutoLayExec =
                "\"" +
                QCoreApplication::applicationDirPath() +
                "/ProlivisAuto.exe\" \"" +
                oReadFile.fileName() +
                "\" -f \"" +
                tmp_strGMLFile +
                "\" \"" +
                tmp_strResultFile +
                "\"";

        qDebug(strAutoLayExec.toStdString().c_str());

        QProcess *myProcess = new QProcess();
        myProcess->start(strAutoLayExec);
        qDebug("Waiting...");
        while (!myProcess->waitForFinished(500))
        {
            ;
        }

        LayoutWidget *lay = new LayoutWidget(tmp_strResultFile);
        lay->desktopHeight = this->desktopHeight;
        lay->desktopWidth = this->desktopWidth;
        lay->organismName = this->organismName;
        lay->setFileName(strFileName);

        QTableView *table = new QTableView;
        model = new QStandardItemModel(tmp_listUniqueGenes.size(), 1, this);

        for( int i = 0; i < tmp_listUniqueGenes.size(); i++ ){
            QString pieces = tmp_listUniqueGenes.at(i);
            model->insertRows(i, 1, QModelIndex());
            model->setData(model->index(i, 0, QModelIndex()), pieces);
            model->setHeaderData(0, Qt::Horizontal, tr("Genes"));
        }

        table->setModel(model);
        QDialog *w2 = new QDialog();

        QString windowName;
        windowName.append("Network View - ");
        windowName.append(this->organismName + " - ");
        windowName.append(MainNode.replace("_", " "));

        w2->setWindowTitle(windowName);

        QGridLayout *grid = new QGridLayout;
        grid->setColumnMinimumWidth(3,200);
        grid->addWidget(lay,0,0,-1,3 );
        grid->addWidget(table,0,3,-1,2 );

        w2->setLayout(grid);
        grid->addWidget(lay);
        w2->setModal(Qt::NonModal);
        w2->show();
    }
}

void GraphWidget::selfNodeVisualization(QString MainNode)
{

    QSqlDatabase db;
    db = QSqlDatabase::addDatabase("QSQLITE");

    QString dbPath = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" + this->organismName + ".db.sqlite";
    qDebug(dbPath.toStdString().c_str());
    db.setDatabaseName(dbPath);
    db.open();

    QSqlQuery query("PRAGMA cache_size = 16384");

    db.exec("BEGIN TRANSACTION;");
    query.exec(
             "SELECT SOURCE, EXPERIMENTSYSTEM, PUBMEDID, GENEA, GENEB "
             "FROM INTERACTIONS "
             "WHERE SOURCE = '" + MainNode.replace("_", " ") + "' "
             "ORDER BY GENEA;"
    );

    qDebug(QString("SELECT SOURCE, EXPERIMENTSYSTEM, PUBMEDID, GENEA, GENEB "
                   "FROM INTERACTIONS "
                   "WHERE SOURCE = '" + MainNode.replace("_", " ") + "' "
                   "ORDER BY GENEA;").toStdString().c_str());

    QList<CQueryResultInteractions> listQueryResultInts;
    QMap<QString,QList<CQueryResultInteractions> > mapQueryResultExp;
    QList<QString> tmp_listGenes, tmp_listUniqueGenes;
    int iSourceInteractionCount = 0;
    QString strFileName = "";

    while (query.next()) {
        CQueryResultInteractions tmp_oQueryResultInt;
        tmp_oQueryResultInt.source = query.value(0).toString().replace(" ","_");
        tmp_oQueryResultInt.experiment = query.value(1).toString().replace(" ","_");
        tmp_oQueryResultInt.pubmedid = query.value(2).toString();
        tmp_oQueryResultInt.geneA = query.value(3).toString();
        tmp_listGenes.append(tmp_oQueryResultInt.geneA);
        tmp_oQueryResultInt.geneB = query.value(4).toString();
        tmp_listGenes.append(tmp_oQueryResultInt.geneB);
        listQueryResultInts.push_back(tmp_oQueryResultInt);
        qDebug(tmp_oQueryResultInt.geneA.toStdString().c_str());
        if ( iSourceInteractionCount == 0 )
        {
            strFileName = QCoreApplication::applicationDirPath() + "/data/3_2_106_osprey/" +  this->organismName + "/" + tmp_oQueryResultInt.pubmedid;
        }
        iSourceInteractionCount++;
    }

    QFile oReadFile(strFileName.toStdString().c_str());

    if (!oReadFile.open(QIODevice::ReadWrite | QIODevice::Text))
    {
        qDebug("File could not be opened!");
    }
    else
    {
        QTextStream filestream(&oReadFile);
        tmp_listUniqueGenes.removeDuplicates();
        filestream << tmp_listUniqueGenes.size() << "\n";

        QList<QString>::iterator iterate = tmp_listUniqueGenes.begin();
        for ( ; iterate != tmp_listUniqueGenes.end(); iterate++ )
        {
            qDebug((*iterate).toStdString().c_str());
            filestream << (*iterate) << "\t"
                       << 10 << "\t"
                       << 10 << "\n";
        }

        filestream << listQueryResultInts.size() << "\n";
        QList<CQueryResultInteractions>::iterator iterateInteractions = listQueryResultInts.begin();
        for ( ; iterateInteractions != listQueryResultInts.end(); iterateInteractions++ )
        {
            filestream << (*iterateInteractions).geneA << "\t"
                       << (*iterateInteractions).geneB << "\n";
        }

        // Close the file
        oReadFile.close();

        // Exec auto layout algorithm
        QString tmp_strGMLFile = "";
        tmp_strGMLFile.append(oReadFile.fileName()).append(".gml");
        QString tmp_strResultFile = "";
        tmp_strResultFile.append(oReadFile.fileName()).append("Result.txt");

        QString strAutoLayExec =
                "\"" +
                QCoreApplication::applicationDirPath() +
                "/ProlivisAuto.exe\" \"" +
                oReadFile.fileName() +
                "\" -f \"" +
                tmp_strGMLFile +
                "\" \"" +
                tmp_strResultFile +
                "\"";

        qDebug(strAutoLayExec.toStdString().c_str());

        QProcess *myProcess = new QProcess();
        myProcess->start(strAutoLayExec);
        qDebug("Waiting...");
        while (!myProcess->waitForFinished(500))
        {
            ;
        }

        LayoutWidget *lay = new LayoutWidget(tmp_strResultFile);
        lay->desktopHeight = this->desktopHeight;
        lay->desktopWidth = this->desktopWidth;
        lay->organismName = this->organismName;
        lay->setFileName(strFileName);

        QTableView *table = new QTableView;
        model = new QStandardItemModel(tmp_listUniqueGenes.size(), 1, this);

        for( int i = 0; i < tmp_listUniqueGenes.size(); i++ ){
            QString pieces = tmp_listUniqueGenes.at(i);
            model->insertRows(i, 1, QModelIndex());
            model->setData(model->index(i, 0, QModelIndex()), pieces);
            model->setHeaderData(0, Qt::Horizontal, tr("Genes"));
        }

        table->setModel(model);
        QDialog *w2 = new QDialog();

        QString windowName;
        windowName.append("Network View - ");
        windowName.append(this->organismName + " - ");
        windowName.append(MainNode.replace("_", " "));

        w2->setWindowTitle(windowName);

        QGridLayout *grid = new QGridLayout;
        grid->setColumnMinimumWidth(3,200);
        grid->addWidget(lay,0,0,-1,3 );
        grid->addWidget(table,0,3,-1,2 );

        w2->setLayout(grid);
        grid->addWidget(lay);
        w2->setModal(Qt::NonModal);
        w2->show();
    }
}

void GraphWidget::mouseDoubleClickEvent( QMouseEvent *event ){
    ;
}

void GraphWidget::open(){
    ;
}

void GraphWidget::itemMoved()
{
    if (!timerId)
        timerId = startTimer(1000 / 25);
}

void GraphWidget::wheelEvent(QWheelEvent *event)
{
    scaleView(pow((double)2, event->angleDelta().x() / 240.0));
}

void GraphWidget::drawBackground(QPainter *painter, const QRectF &rect)
{

}

void GraphWidget::scaleView(qreal scaleFactor)
{
    scale(scaleFactor, scaleFactor);
}

void GraphWidget::mousePressEvent(QGraphicsSceneMouseEvent *event)
{
    setCursor(Qt::ClosedHandCursor);
}


void GraphWidget::mouseReleaseEvent(QGraphicsSceneMouseEvent *)
{
    setCursor(Qt::OpenHandCursor);
}

