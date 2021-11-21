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

#include "layoutwidget.h"
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

#include <math.h>
using namespace std;

LayoutWidget::LayoutWidget(QString &in_strFilename)
    : timerId(0)
{
    QWidget *W = new QWidget();
    QGraphicsScene *scene = new QGraphicsScene(W);

    scene->setItemIndexMethod(QGraphicsScene::NoIndex);
    setScene(scene);
    setCacheMode(CacheBackground);
    setViewportUpdateMode(BoundingRectViewportUpdate);
    setRenderHint(QPainter::Antialiasing);
    setTransformationAnchor(AnchorUnderMouse);
    setResizeAnchor(AnchorViewCenter);


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

    double size1=25.0,size2=25.0;
    while( count != number ){
        filestream >> labelName;
//        printf( "%d %d %d %s %s", count, number2, id , labelName, labelName2);
        int count2 = 0;
        filestream >> xcoord >> ycoord;

        qDebug(labelName);
//        printf( "%d %d %lf %lf %s %lf %lf\n", id, react_type, size1, size2, labelName, xcoord, ycoord );
        Node *node1 = new Node(this,(size1),(size2), labelName, react_type, xcoord, ycoord );
        scene->addItem(node1);
        node1->setZValue(100);
        node1->setPos((qreal)xcoord, (qreal)ycoord);
        node1->setToolTip(labelName);
        node1->setFlag(QGraphicsItem::ItemIsMovable, true);
//        node1->opacity();
        node1->ensureVisible((qreal)xcoord,(qreal)ycoord,(qreal)size1,(qreal)size2,10,10);
        node1->clicked = false;
        node1->setOpacity(0.8);

        mapNodes[QString(labelName)] = node1;
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

    myReadFile.close();
    //scene->setSceneRect( xcoord_min-300, ycoord_min - 300.0, abs(xcoord_max - xcoord_min) + 600.0, abs(ycoord_max - ycoord_min) + 600.0);
    scale(qreal(0.8), qreal(0.8));
    scene->createItemGroup(allItemsGroup);
    setMinimumSize(400, 300);
}

void LayoutWidget::resizeEvent(){
//    LayoutWidget::fitInView(LayoutWidget::sceneRect(),Qt::AspectRatioMode );
}


void LayoutWidget::mouseDoubleClickEvent( QMouseEvent *event ){
    if (event->button() == Qt::RightButton){
            QPointF P;
            P = mapToScene(event->pos());
            QString MainNode;
            Node *found;
            for (int i = 0; i < Nodes.size(); i++){
                Node *node = Nodes.at(i);
                if( node->pos().x() < P.x() + node->width/2 && node->pos().x() > P.x() - node->width/2 &&
                    node->pos().y() < P.y() + node->height/2 && node->pos().y() > P.y() - node->height/2
                   ){
                    MainNode = node->toolTip();
                    found = node;
                    break;
                }
            }


            QWidget *centralWidget = new QWidget();
            //QWidget *lay = new QWidget();
            QTabWidget *tab = new QTabWidget(centralWidget);
            tab->setGeometry(0,20,this->desktopWidth-20, this->desktopHeight-90);
            //QWebView *webView = new QWebView(tab);

            QString nodeName;
            nodeName.append("http://thebiogrid.org/search.php?search=");
            nodeName.append(MainNode);
            nodeName.append("&organism=all");
            //webView->setUrl(QUrl(nodeName));
            //webView->setObjectName(QString::fromUtf8("webView"));
            //webView->setGeometry(0,20,this->desktopWidth-20, this->desktopHeight-90);
            //webView->setGeometry(QRect(10, 10, 760, 620 ));
            //tab->addTab(webView, QString("The BioGRID Database"));
            //QWebView *webView2 = new QWebView(tab);

            QString nodeName2;
            nodeName2.append("http://www.uniprot.org/uniprot/?query=");
            nodeName2.append(MainNode);
            nodeName2.append("&sort=score");
            //webView2->setUrl(QUrl(nodeName2));
            //webView2->setObjectName(QString::fromUtf8("webView"));
            //webView2->setGeometry(0,20,this->desktopWidth-20, this->desktopHeight-90);
            //webView2->setGeometry(QRect(10, 10, 760, 620 ));
            //tab->addTab(webView2, QString("UniProt Database"));

            //QWebView *webView3 = new QWebView(tab);
            QString nodeName3;
            nodeName3.append("http://amigo.geneontology.org/cgi-bin/amigo/search.cgi?search_query=");
            nodeName3.append(MainNode);
            nodeName3.append("&action=new-search&search_constraint=gp");
            //webView3->setUrl(QUrl(nodeName3));
            //webView3->setObjectName(QString::fromUtf8("webView"));
            //webView3->setGeometry(0,20,this->desktopWidth-20, this->desktopHeight-90);
            //webView2->setGeometry(QRect(10, 10, 760, 620 ));
            //tab->addTab(webView3, QString("Gene Ontology Amigo"));

            //QWebView *webView4 = new QWebView(tab);
            QString nodeName4;
            nodeName4.append("http://string-db.org/api/image/network?identifiers=");
            nodeName4.append(MainNode);
            nodeName4.append("&required_score=950&network_depth=2&limit=10&network_flavor=evidence");
            //webView4->setUrl(QUrl(nodeName4));
            //webView4->setObjectName(QString::fromUtf8("webView"));
            //webView4->setGeometry(0,20,this->desktopWidth-20, this->desktopHeight-90);
            //webView2->setGeometry(QRect(10, 10, 760, 620 ));
            //tab->addTab(webView4, QString("STRING Two Level Interactions"));

            QDialog *web = new QDialog();
            web->setGeometry(QRect(0,20,this->desktopWidth,this->desktopHeight-70));
            QGridLayout *grid = new QGridLayout;            
            grid->addWidget(centralWidget,0, 0, 1, 3 );
            //grid->addWidget(lay,0, 4, 1, 1  );
            web->setLayout(grid);
            web->setMinimumSize(this->width(), this->height());
            web->setWindowTitle("Protein Outsourced Information");
            web->exec();
    }
    if (event->button() == Qt::LeftButton){
        QList<int> count;
        for( int i = 0; i < Nodes.size(); i++ )
            count.append( 0 );
        for( int i = 0; i < edgeLabel.size(); i++ ){
            QString M1 = edgeLabel.at(i).first.first;
            QString M2 = edgeLabel.at(i).first.second;
            for( int j = 0; j < Nodes.size(); j++ ){
                Node *node = Nodes.at(j);
                if( QString::compare(node->toolTip(), M1 ) == 0 )
                    count[j] += 1;
                if( QString::compare(node->toolTip(), M2 ) == 0 )
                    count[j] += 1;
            }
        }
        FILE *fptr = fopen( "input/chart.cht", "w" );
        double mean = 0;
        for( int i = 0; i < Nodes.size(); i++ ){
            mean += (double) count[i];
        }
        mean = mean / (double)(Nodes.size()+1);

        for( int i = 0; i < Nodes.size(); i++ ){
            if( mean < count[i] ){
                Node *node = Nodes.at(i);
                if( i % 8 == 0 )
                    fprintf( fptr, "%s,%d,red\n", node->toolTip().constData(), count[i]  );
                if( i % 8 == 1 )
                    fprintf( fptr, "%s,%d,blue\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 2 )
                    fprintf( fptr, "%s,%d,yellow\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 3 )
                    fprintf( fptr, "%s,%d,lightblue\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 4 )
                    fprintf( fptr, "%s,%d,magenta\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 5 )
                    fprintf( fptr, "%s,%d,purple\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 6 )
                    fprintf( fptr, "%s,%d,lightgreen\n", node->toolTip().constData(), count[i] );
                if( i % 8 == 7 )
                    fprintf( fptr, "%s,%d,lightyellow\n", node->toolTip().constData(), count[i] );
            }
        }
        fclose(fptr);
        system( "chart.exe" );
    }
}

void LayoutWidget::open(){
    ;
}

void LayoutWidget::itemMoved()
{
    if (!timerId)
        timerId = startTimer(1000 / 25);
}

void LayoutWidget::wheelEvent(QWheelEvent *event)
{
    scaleView(pow((double)2, event->angleDelta().x() / 240.0));
}

void LayoutWidget::drawBackground(QPainter *painter, const QRectF &rect)
{
//    Q_UNUSED(rect);
//
//    // Shadow
//    QRectF sceneRect = this->sceneRect();
//    QRectF rightShadow(sceneRect.right(), sceneRect.top() + 5, 5, sceneRect.height());
//    QRectF bottomShadow(sceneRect.left() + 5, sceneRect.bottom(), sceneRect.width(), 5);
//    if (rightShadow.intersects(rect) || rightShadow.contains(rect))
//	painter->fillRect(rightShadow, Qt::darkGray);
//    if (bottomShadow.intersects(rect) || bottomShadow.contains(rect))
//	painter->fillRect(bottomShadow, Qt::darkGray);
//
//    // Fill
//    QLinearGradient gradient(sceneRect.topLeft(), sceneRect.bottomRight());
//    gradient.setColorAt(0, Qt::white);
//    gradient.setColorAt(1, Qt::lightGray);
//    painter->fillRect(rect.intersect(sceneRect), gradient);
//    painter->setBrush(Qt::NoBrush);
//    painter->drawRect(sceneRect);
//
//    // Text
//    QRectF textRect(sceneRect.left() + 4, sceneRect.top() + 4,
//                    sceneRect.width() - 4, sceneRect.height() - 4);
//    QString message(tr(""));
//
//    QFont font = painter->font();
//    font.setBold(true);
//    font.setPointSize(14);
//    painter->setFont(font);
//    painter->setPen(Qt::lightGray);
//    painter->drawText(textRect.translated(2, 2), message);
//    painter->setPen(Qt::black);
//    painter->drawText(textRect, message);
}

void LayoutWidget::scaleView(qreal scaleFactor)
{
    scale(scaleFactor, scaleFactor);
}

void LayoutWidget::mousePressEvent(QGraphicsSceneMouseEvent *event)
{
    setCursor(Qt::ClosedHandCursor);
}


void LayoutWidget::mouseReleaseEvent(QGraphicsSceneMouseEvent *)
{
    setCursor(Qt::OpenHandCursor);
}


