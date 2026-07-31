import React from 'react';

export class CardDetailErrorBoundary extends React.Component{
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(err){return{error:err};}
  componentDidCatch(err,info){console.error('CardDetail render error:',err,info);}
  render(){
    if(this.state.error){
      return(
        <div style={{padding:32,maxWidth:700,margin:'0 auto'}}>
          <div style={{background:'rgba(248,113,113,0.08)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:10,padding:20}}>
            <div style={{fontSize:15,fontWeight:400,color:'var(--red)',marginBottom:8}}>⚠ Card detail failed to render</div>
            <div style={{fontSize:12,color:'var(--red)',opacity:0.85,fontFamily:'monospace',whiteSpace:'pre-wrap',wordBreak:'break-all'}}>
              {this.state.error?.message||String(this.state.error)}
            </div>
            <button type="button" className="btn btn-ghost" style={{marginTop:14,fontSize:13}}
              onClick={()=>{this.setState({error:null});this.props.onBack&&this.props.onBack();}}>
              ← Back
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
