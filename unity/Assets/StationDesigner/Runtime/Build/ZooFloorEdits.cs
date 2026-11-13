using System.Collections.Generic;

namespace Metro.Build {
    // Only authored walkable floor is editable in this first Zoo slice. The
    // same verdict is used for the preview and the eventual transaction.
    public sealed class ZooFloorEdits {
        readonly HashSet<(int,int,int)> allowed;
        public ZooFloorEdits(IEnumerable<(int,int,int)> allowed) { this.allowed=new HashSet<(int,int,int)>(allowed); }
        public bool CanSet(int x,int y,int z,bool exists,bool place) => allowed.Contains((x,y,z)) && exists != place;
        public bool CanSetGate(bool exists,bool place,bool supported) => exists != place && (!place || supported);
    }
}
