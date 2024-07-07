
import path from 'path';
import fs from 'node:fs/promises';
import LogObject from './Log';
const { Log } = LogObject.bind("FileSearch");

type searchResults = {
    name: string;
    isFolder: boolean;
};

const search = async (baseDir: string, query: string): Promise<searchResults[]> => {
    query = query.replace(/^@/, ".");
    Log("File Search");
    try{
        const items = (await fs.readdir(path.join(baseDir, query), {
            withFileTypes: true,
            recursive: false
        })).map((dir): searchResults => {
            return {
                name: dir.name,
                isFolder: dir.isDirectory()
            };
        }).filter(res => {
            if(res.isFolder) return true;
            else{
                const extensions = [".m", ".mag", ".magma", "..magmarc", "..magmarc-dev"];
                const name = res.name;
                return extensions.some(ext => name.endsWith(ext));
            }
        });
        Log(items);
        return items;
    }catch(e){
        Log("ERRORED");
        return [];
    }
};

export default search;
