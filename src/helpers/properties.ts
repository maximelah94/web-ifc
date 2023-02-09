import {
    IfcAPI, IfcEntities,
    IFCPROJECT, IFCRELAGGREGATES,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
    IFCRELDEFINESBYPROPERTIES,
    IFCRELASSOCIATESMATERIAL,
    IFCRELDEFINESBYTYPE
} from "../web-ifc-api";

interface pName {
    name: number;
    relating: string;
    related: string;
    key: string;
}

interface Node {
    expressID: number;
    type: string;
    children: Node[];
}

const PropsNames = {
    aggregates: {
        name: IFCRELAGGREGATES,
        relating: 'RelatingObject',
        related: 'RelatedObjects',
        key: 'children'
    },
    spatial: {
        name: IFCRELCONTAINEDINSPATIALSTRUCTURE,
        relating: 'RelatingStructure',
        related: 'RelatedElements',
        key: 'children'
    },
    psets: {
        name: IFCRELDEFINESBYPROPERTIES,
        relating: 'RelatingPropertyDefinition',
        related: 'RelatedObjects',
        key: 'IsDefinedBy'
    },
    materials: {
        name: IFCRELASSOCIATESMATERIAL,
        relating: 'RelatingMaterial',
        related: 'RelatedObjects',
        key: 'HasAssociations',
    },
    type: {
        name: IFCRELDEFINESBYTYPE,
        relating: 'RelatingType',
        related: 'RelatedObjects',
        key: 'IsDefinedBy'
    }
};

export class Properties {

    constructor(private api: IfcAPI) {
    }

    getIfcType(type: number) {
       return IfcEntities[type];
    }

    async getItemProperties(modelID: number, id: number, recursive = false, inverse = false) {
        return this.api.GetLine(modelID, id, recursive, inverse);
    }

    async getPropertySets(modelID: number, elementID = 0, recursive = false) {
        return await this.getRelatedProperties(modelID, elementID, PropsNames.psets, recursive);
    }

	async setPropertySets(modelID: number, elementID: number|number[], psetID: number|number[]) {
		return this.setItemProperties(modelID, elementID,  psetID, PropsNames.psets);
	}

    async getTypeProperties(modelID: number, elementID: number, recursive = false) {
        if (this.api.GetModelSchema(modelID) == 'IFX2X3')
        {
          return await this.getRelatedProperties(modelID, elementID, PropsNames.type, recursive);
        } 
        else
        {
          return await this.getRelatedProperties(modelID, elementID, {...PropsNames.type, key: 'IsTypedBy'}, recursive);
        }
    }

    async getMaterialsProperties(modelID: number, elementID = 0, recursive = false) {
        return await this.getRelatedProperties(modelID, elementID, PropsNames.materials, recursive);
    }

	async setMaterialsProperties(modelID: number, elementID: number|number[], materialID: number|number[]) {
		return this.setItemProperties(modelID, elementID,  materialID, PropsNames.materials);
	}

    async getSpatialStructure(modelID: number, includeProperties?: boolean): Promise<Node> {
        const chunks = await this.getSpatialTreeChunks(modelID);
        const allLines = await this.api.GetLineIDsWithType(modelID, IFCPROJECT);
        const projectID = allLines.get(0);
        const project = Properties.newIfcProject(projectID);
        await this.getSpatialNode(modelID, project, chunks, includeProperties);
        return project;
    }


    private async getRelatedProperties(modelID: number, elementID: number, propsName: pName, recursive = false) {
        const result: any[] = [];
        let rels = null;
        if (elementID !== 0)
            rels = await this.api.GetLine(modelID, elementID, false, true)[propsName.key];
        else
            rels = this.api.GetLineIDsWithType(modelID, propsName.name);
            
        if (rels == null ) return result;
        if (!Array.isArray(rels)) rels = [rels];
        for (let i = 0; i < rels.length; i++) {
          let propSetIds =  await this.api.GetLine(modelID, rels[i].value, false, false)[propsName.relating];
          if (propSetIds == null) continue;
          if (!Array.isArray(propSetIds)) propSetIds = [propSetIds];
          for (let x = 0; x < propSetIds.length; x++) {
            result.push(await this.api.GetLine(modelID, propSetIds[x].value, recursive));
          }
        }
        return result;
    }

    private async getChunks(modelID: number, chunks: any, propNames: pName) {
        const relation = await this.api.GetLineIDsWithType(modelID, propNames.name, true);
        for (let i = 0; i < relation.size(); i++) {
            const rel = await this.api.GetLine(modelID, relation.get(i), false);
            this.saveChunk(chunks, propNames, rel);
        }
    }

    private static newIfcProject(id: number) {
        return {
            expressID: id,
            type: 'IFCPROJECT',
            children: []
        };
    }

    private async getSpatialNode(modelID: number, node: Node, treeChunks: any, includeProperties?: boolean) {
        await this.getChildren(modelID, node, treeChunks, PropsNames.aggregates, includeProperties);
        await this.getChildren(modelID, node, treeChunks, PropsNames.spatial, includeProperties);
    }

    private async getChildren(modelID: number, node: Node, treeChunks: any, propNames: pName, includeProperties?: boolean) {
        const children = treeChunks[node.expressID];
        if (children == undefined) return;
        const prop = propNames.key as keyof Node;
        const nodes: any[] = [];
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            let node = this.newNode(child,this.api.GetLineType(modelID, child));
            if (includeProperties) {
                const properties = await this.getItemProperties(modelID, node.expressID) as any;
                node = {...properties, ...node};
            }
            await this.getSpatialNode(modelID, node, treeChunks, includeProperties);
            nodes.push(node);
        }
        (node[prop] as Node[]) = nodes;
    }

    private newNode(id: number, type: number) {
        return {
            expressID: id,
            type: IfcEntities[type],
            children: []
        };
    }
    private async getSpatialTreeChunks(modelID: number) {
        const treeChunks: any = {};
        await this.getChunks(modelID, treeChunks, PropsNames.aggregates);
        await this.getChunks(modelID, treeChunks, PropsNames.spatial);
        return treeChunks;
    }

    private saveChunk(chunks: any, propNames: pName, rel: any) {
        const relating = rel[propNames.relating].value;
        const related = rel[propNames.related].map((r: any) => r.value);
        if (chunks[relating] == undefined) {
            chunks[relating] = related;
        } else {
            chunks[relating] = chunks[relating].concat(related);
        }
    }

	private async setItemProperties(modelID: number, elementID: number|number[], propID: number|number[], propsName: pName) {
		if (!Array.isArray(elementID)) elementID = [elementID];
		if (!Array.isArray(propID)) propID = [propID];
		let foundRel = 0;
		const rels: any[] = [];
		const elements: any[] = [];
		for(const elID of elementID) {
			const element = await this.api.GetLine(modelID, elID, false, true);
			if (!element[propsName.key]) continue;
			elements.push(element);
		}
		if (elements.length < 1) return false;
		const relations = this.api.GetLineIDsWithType(modelID, propsName.name);
		for (let i = 0; i < relations.size(); ++i) {
			const rel = await this.api.GetLine(modelID, relations.get(i));
			if (propID.includes(Number(rel[propsName.relating].value))) {
				rels.push(rel);	
				foundRel++;
			}
			if (foundRel == propID.length) break;
		}
		for (const element of elements) {
			for (const rel of rels) {
				rel[propsName.related].push({ type: 5, value: element.expressID });
				element[propsName.key].push({ type: 5, value: rel.expressID });
				this.api.WriteLine(modelID, rel);
			}
			this.api.WriteLine(modelID, element);
		}
		return true;
	}
}
