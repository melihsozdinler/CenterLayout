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

#ifndef NODE_H
#define NODE_H

#include <QGraphicsItem>
#include <QList>
#include <QMouseEvent>

//class Edge;
class GraphWidget;
class SubGraphWidget;
class LayoutWidget;

QT_BEGIN_NAMESPACE
class QGraphicsSceneMouseEvent;
QT_END_NAMESPACE

class Node : public QGraphicsItem
{
public:
    double width;
    double height;
    char names[256];
    bool clicked;
    int color;
    qreal xcoord;
    qreal ycoord;
    Node(GraphWidget *graphWidget, double size1, double size2, char names_[256], int col, qreal x, qreal y );
    Node(QWidget *layoutWidget, double size1, double size2, char names_[256], int col, qreal x, qreal y );
    Node(QWidget *w, double size1, double size2, char names_[256] );

//    void addEdge(Edge *edge);
//    QList<Edge *> edges() const;

    enum { Type = UserType + 1 };
    int type() const { return Type; }
    QRectF rectangleNode;

    bool advance();

    QRectF boundingRect() const;
    QPainterPath shape() const;
    void paint(QPainter *painter, const QStyleOptionGraphicsItem *option, QWidget *widget);
    bool mouseDoubleClickEvent( QMouseEvent *event );
protected:
    QVariant itemChange(GraphicsItemChange change, const QVariant &value);
//    void mouseReleaseEvent(QGraphicsSceneMouseEvent *event);
    
private:
//    QList<Edge *> edgeList;
    QPointF newPos;
    GraphWidget *graph;
    QWidget *layout;
    QWidget *w;
};

#endif
