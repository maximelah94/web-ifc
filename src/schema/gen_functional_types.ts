import {} from "./gen_functional_types_interfaces";
import {findSubClasses,sortEntities,generateClass,crc32,makeCRCTable, parseElements, walkParents} from "./gen_functional_types_helpers"

const fs = require("fs");
const { type } = require("os");

let crcTable = makeCRCTable();

console.log("Starting...");

let tsHelper = [];
tsHelper.push(`// This is a generated file, please see: gen_functional_types.js`);
tsHelper.push(`import * as ifc from "./ifc-schema";`);
tsHelper.push();
tsHelper.push(`export class Handle<T> {`);
tsHelper.push(`\tvalue: number;`);
tsHelper.push(`\tconstructor(id: number) { this.value = id; }`);
tsHelper.push(`\ttoTape(args: any[]){ args.push({ type: 5, value: this.value }); }`);
tsHelper.push(`}`);
tsHelper.push(``);
tsHelper.push(`export function Value(type: string, value: any): any { return { t: type, v: value }; }`);

tsHelper.push(`const UNKNOWN = 0;`);
tsHelper.push(`const STRING = 1;`);
tsHelper.push(`const LABEL = 2;`);
tsHelper.push(`const ENUM = 3;`);
tsHelper.push(`const REAL = 4;`);
tsHelper.push(`const REF = 5;`);
tsHelper.push(`const EMPTY = 6;`);
tsHelper.push(`const SET_BEGIN = 7;`);
tsHelper.push(`const SET_END = 8;`);
tsHelper.push(`const LINE_END = 9;`);
tsHelper.push(`export let FromRawLineData = {};`);
tsHelper.push(`export let InversePropertyDef = {};`);
tsHelper.push(`export let InheritanceDef = {};`);

let tsHelperClasses = [];

let completeEntityList = new Set();
completeEntityList.add("FILE_SCHEMA");
completeEntityList.add("FILE_NAME");
completeEntityList.add("FILE_DESCRIPTION");
let completeifcElementList = new Set();

var files = fs.readdirSync("./");
for (var i = 0; i < files.length; i++) {
  if (!files[i].endsWith(".exp")) continue;
  var schemaName = files[i].replace(".exp","");
  console.log("Generating Schema for:"+schemaName);
  tsHelper.push(`FromRawLineData['${schemaName}'] = {};`);
  tsHelper.push(`InversePropertyDef['${schemaName}'] = {};`);
  tsHelper.push(`InheritanceDef['${schemaName}'] = {};`);
  tsHelperClasses.push(`namespace ${schemaName} {`);
  let schemaData = fs.readFileSync("./"+files[i]).toString();
  let parsed = parseElements(schemaData);
  let entities = sortEntities(parsed.entities);
  let types = parsed.types;
  
  types.forEach((type) => {
      if (type.isList)
      {
          tsHelperClasses.push(`\texport type ${type.name} = Array<${type.typeName}>;`);
      }
      else if (type.isSelect)
      {
          tsHelperClasses.push(`\texport type ${type.name} = `);
          type.values.forEach(refType => {
              let isType: Type = types.some( x => x.name == refType.name);
              if (isType)
              {
                  tsHelperClasses.push(`\t\t| ${refType}`);
              }
              else
              {
                  tsHelperClasses.push(`\t\t| (Handle<${refType}> | ${refType})`);
              }
          });
          tsHelperClasses.push(`\t;`);
      }
      else if (type.isEnum)
      {
          tsHelperClasses.push(`\texport class ${type.name} {`);
          tsHelperClasses.push(`\t\tvalue: string;`)
          tsHelperClasses.push(`\t\tconstructor(v: string) { this.value = v;}`);
          tsHelperClasses.push(type.values.map((v) => `\t\tstatic ${v} = "${v}";`).join("\n"));
          tsHelperClasses.push(`\t};`);
      }
      else
      {
          tsHelperClasses.push(`\texport class ${type.name} {`);
          tsHelperClasses.push(`\t\tvalue: ${type.typeName};`)
          tsHelperClasses.push(`\t\tconstructor(v: ${type.typeName}) { this.value = v;}`);
          tsHelperClasses.push(`\t};`);
      }
  });
  
  entities.forEach((e) => {
      walkParents(e,entities);
  });
  
  //now work out the children
  entities = findSubClasses(entities);
  
  for (var x=0; x < entities.length; x++) 
  {
      generateClass(entities[x],tsHelperClasses,types, schemaName);
      completeEntityList.add(entities[x].name);
      if (entities[x].isIfcProduct)
      {
        completeifcElementList.add(entities[x].name);
      }
  
      tsHelper.push(`FromRawLineData['${schemaName}'][ifc.${entities[x].name.toUpperCase()}] = (d) => { return ${schemaName}.${entities[x].name}.FromTape(d.ID, d.type, d.arguments); }`);
    
      if (entities[x].children.length > 0)
      {
        tsHelper.push(`InheritanceDef['${schemaName}'][ifc.${entities[x].name.toUpperCase()}] = [${entities[x].children.map((c) => `ifc.${c.toUpperCase()}`).join(",")}];`);
      }
      
      if (entities[x].derivedInverseProps.length > 0)
      {
        tsHelper.push(`InversePropertyDef['${schemaName}'][ifc.${entities[x].name.toUpperCase()}] = [`);
        entities[x].derivedInverseProps.forEach((prop) => {
          let pos = 0;
          //find the target element
          for (targetEntity of entities) 
          {
            if (targetEntity.name == prop.type) 
            {
              for (let i=0; i < targetEntity.derivedProps.length;i++)
              {
                  if (targetEntity.derivedProps[i].name == prop.for) 
                  {
                    pos = i;
                    break;
                  }
              }
              break;
            }
          }
          let type  = `ifc.${prop.type.toUpperCase()}`
          tsHelper.push(`\t\t ['${prop.name}',${type},${pos},${prop.set}],`);
        });
        tsHelper.push(`];`);
        
      }
  }  
  tsHelperClasses.push("}");
}

//finish writing the TS metaData
tsHelper = tsHelper.concat(tsHelperClasses);
fs.writeFileSync("../ifc_schema_helper.ts", tsHelper.join("\n")); 

// now write out the global c++/ts metadata. All the WASM needs to know about is a list of all entities

console.log(`Writing Global WASM/TS Metadata!...`);

let tsHeader = []
let cppHeader = [];
cppHeader.push("#pragma once");
cppHeader.push("");
cppHeader.push("#include <vector>");
cppHeader.push("");
cppHeader.push("// unique list of crc32 codes for ifc classes - this is a generated file - please see schema generator in src/schema");
tsHeader.push("// unique list of crc32 codes for ifc classes - this is a generated file - please see schema generator in src/schema");
cppHeader.push("");
cppHeader.push("namespace ifc {");
completeEntityList.forEach(entity => {
    let name = entity.toUpperCase();
    let code = crc32(name,crcTable);
    cppHeader.push(`\tstatic const unsigned int ${name} = ${code};`);
    tsHeader.push(`export const ${name} = ${code};`)
});

cppHeader.push("\tbool isIfcElement(unsigned int ifcCode) {");
cppHeader.push("\t\tswitch(ifcCode) {");

completeifcElementList.forEach(element => {
    let name = element.toUpperCase();
    let code = crc32(name,crcTable);
    cppHeader.push(`\t\t\tcase ifc::${name}: return true;`);
});

cppHeader.push(`\t\t\tdefault: return false;`);

cppHeader.push("\t\t}");
cppHeader.push("\t}");


cppHeader.push("\tstd::vector<unsigned int> IfcElement { ");
completeifcElementList.forEach(element => {
    let name = element.toUpperCase();
    let code = crc32(name,crcTable);
    cppHeader.push(`\t\t${name},`);
});
cppHeader.push("\t};");

cppHeader.push("};");

cppHeader.push("\tconst char* GetReadableNameFromTypeCode(unsigned int ifcCode) {");
cppHeader.push("\t\tswitch(ifcCode) {");
tsHeader.push("export const IfcEntities: {[key: number]: string} = {");
completeEntityList.forEach(entity => {
    let name = entity.toUpperCase();
    let code = crc32(name,crcTable);
    cppHeader.push(`\t\t\tcase ifc::${name}: return "${name}";`);
    tsHeader.push(`\t${code}: '${name}',`);
});
tsHeader.push("};")

cppHeader.push(`\t\t\tdefault: return "<web-ifc-type-unknown>";`);

cppHeader.push("\t\t}");
cppHeader.push("\t}");

fs.writeFileSync("../wasm/include/ifc-schema.h", cppHeader.join("\n")); 
fs.writeFileSync("../ifc-schema.ts", tsHeader.join("\n")); 

console.log(`...Done!`);
